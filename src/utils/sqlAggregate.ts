// SQL aggregate executor — handles SELECT statements with count/sum/avg/min/max
// and/or GROUP BY. Lives OUTSIDE the relational-algebra engine on purpose:
// these are SQL features and have no equivalent in the classical algebra the
// rest of derup teaches. Adding γ to the algebra engine just to support SQL
// would be over-engineering — see commit 1457a83 (revert).
//
// How it works:
//   1. Parse the SQL just enough to split SELECT items, FROM, WHERE, GROUP BY.
//   2. Bail to null (caller falls back to the algebra path) if the SELECT
//      has no aggregates AND no GROUP BY — we don't need to be involved.
//   3. Reuse sqlToAlgebra to translate the FROM + WHERE subset into algebra
//      (we get all the JOIN / NATURAL / CROSS / cartesian product / σ logic
//      for free). Parse and evaluate that algebra to get the filtered rows.
//   4. Apply grouping + aggregation directly on the resulting Relation.
//
// Out of scope (return null → caller surfaces the standard "not supported"
// message): HAVING, ORDER BY, LIMIT, UNION, subqueries, OUTER JOIN, arithmetic
// or string expressions in SELECT.

import type { Column, ColumnType, Relation, Value } from './relAlgebra/types';
import { parse } from './relAlgebra/parser';
import { evaluate } from './relAlgebra/evaluator';
import { sqlToAlgebra, splitTopLevel, findKeyword } from './sqlToAlgebra';

type AggFunc = 'count' | 'sum' | 'avg' | 'min' | 'max';

interface AggCall {
  func: AggFunc;
  /** Column name or '*' (only valid for count). */
  arg: string;
  alias: string;
}

export interface SqlAggregateResult {
  result: Relation;
  /** User-facing note describing what was executed. */
  note: string;
}

const COL_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?$/;
const AGG_RE = /^(count|sum|avg|min|max)\s*\(\s*(\*|[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)\s*\)\s*(?:as\s+([a-zA-Z_][a-zA-Z0-9_]*))?$/i;
const AGG_DETECT = /\b(count|sum|avg|min|max)\s*\(/i;

/**
 * Try to execute the SQL as an aggregate query. Returns null when the input:
 *   - isn't a SELECT, or
 *   - has no aggregates and no GROUP BY (caller should use the algebra path), or
 *   - uses something we don't support.
 *
 * On error inside the supported subset, throws an Error with a Spanish message.
 */
export function tryExecuteSqlAggregate(
  input: string,
  env: Map<string, Relation>,
): SqlAggregateResult | null {
  const cleaned = input
    .split('\n')
    .map(l => l.replace(/--.*$/, ''))
    .join('\n')
    .trim()
    .replace(/;+\s*$/, '');

  if (!/^\s*select\s+/i.test(cleaned)) return null;

  // 1) Split into SELECT items / FROM / WHERE / GROUP BY.
  const afterSelect = cleaned.replace(/^\s*select\s+/i, '');
  const fromIdx = findKeyword(afterSelect, /\bfrom\b/i);
  if (fromIdx < 0) return null;
  const selectList = afterSelect.slice(0, fromIdx).trim();
  let rest = afterSelect.slice(fromIdx).replace(/^\s*from\s+/i, '');

  // WHERE (optional)
  let where: string | null = null;
  const whereIdx = findKeyword(rest, /\bwhere\b/i);
  if (whereIdx >= 0) {
    where = rest.slice(whereIdx).replace(/^\s*where\s+/i, '').trim();
    rest = rest.slice(0, whereIdx).trim();
  }

  // GROUP BY (optional — may sit at end of WHERE or end of rest)
  let groupBy: string | null = null;
  const splitGroupBy = (s: string) => {
    const m = s.match(/\bgroup\s+by\b/i);
    if (!m || m.index === undefined) return { head: s, gb: null as string | null };
    return {
      head: s.slice(0, m.index).trim(),
      gb: s.slice(m.index).replace(/^\s*group\s+by\s+/i, '').trim(),
    };
  };
  {
    const fromTail = splitGroupBy(rest);
    if (fromTail.gb) { groupBy = fromTail.gb; rest = fromTail.head; }
    if (where) {
      const whereTail = splitGroupBy(where);
      if (whereTail.gb) { groupBy = whereTail.gb; where = whereTail.head; }
    }
  }

  const hasAgg = AGG_DETECT.test(selectList);

  // Not our path — caller goes through sqlToAlgebra (which handles plain SELECT).
  if (!hasAgg && !groupBy) return null;

  // Unsupported tail clauses → bail so the caller shows the standard error.
  if (/\b(having|order\s+by|limit|union|intersect|except)\b/i.test(rest)) return null;
  if (where && /\b(having|order\s+by|limit|union|intersect|except)\b/i.test(where)) return null;
  if (groupBy && /\b(having|order\s+by|limit|union|intersect|except)\b/i.test(groupBy)) return null;

  // 2) Parse SELECT items.
  const items = splitTopLevel(selectList, ',').map(s => s.trim()).filter(Boolean);
  if (items.length === 0) return null;
  const plain: string[] = [];
  const aggs: AggCall[] = [];
  for (const it of items) {
    if (COL_RE.test(it)) { plain.push(it); continue; }
    const m = it.match(AGG_RE);
    if (m) {
      const func = m[1].toLowerCase() as AggFunc;
      const arg = m[2];
      const alias = m[3] ?? `${func}_${arg === '*' ? 'all' : arg.replace('.', '_')}`;
      if (arg === '*' && func !== 'count') return null; // * only for count
      aggs.push({ func, arg, alias });
      continue;
    }
    return null;
  }

  // 3) GROUP BY columns (explicit or implicit from plain SELECT cols).
  const gbCols = groupBy
    ? splitTopLevel(groupBy, ',').map(c => c.trim()).filter(Boolean)
    : plain.slice();
  for (const g of gbCols) if (!COL_RE.test(g)) return null;
  if (groupBy) {
    for (const p of plain) if (!gbCols.includes(p)) return null; // SQL semantic rule
  }

  // 4) Compute the input relation (FROM + WHERE → algebra → evaluate).
  //    We strip everything except FROM and WHERE because the algebra engine
  //    doesn't need to know about SELECT/GROUP BY — we do those here.
  const subsetSql = `SELECT * FROM ${rest}${where ? ' WHERE ' + where : ''}`;
  const trans = sqlToAlgebra(subsetSql);
  if (!trans) return null;
  let baseRel: Relation;
  try {
    const program = parse(trans.algebra);
    const ev = evaluate(program, env);
    if (!ev.result) return null;
    baseRel = ev.result;
  } catch (e) {
    // Surface the algebra/parser error verbatim — it's already in Spanish.
    throw e instanceof Error ? e : new Error(String(e));
  }

  // 5) Validate columns exist in the filtered relation.
  const findColIdx = (name: string): number => {
    const exact = baseRel.columns.findIndex(c => c.name === name);
    if (exact >= 0) return exact;
    return baseRel.columns.findIndex(c => c.name.endsWith('.' + name));
  };
  const gbIdx = gbCols.map(c => {
    const i = findColIdx(c);
    if (i < 0) throw new Error(`Columna '${c}' no encontrada en la relación.`);
    return i;
  });
  const argIdx = aggs.map(a => {
    if (a.arg === '*') return -1;
    const i = findColIdx(a.arg);
    if (i < 0) throw new Error(`Columna '${a.arg}' no encontrada en la relación.`);
    return i;
  });

  // 6) Validate types for sum/avg (must be numeric).
  for (let k = 0; k < aggs.length; k++) {
    if (aggs[k].arg === '*') continue;
    const t = baseRel.columns[argIdx[k]].type;
    if ((aggs[k].func === 'sum' || aggs[k].func === 'avg') && t !== 'number') {
      throw new Error(`${aggs[k].func}() requiere una columna numérica; '${aggs[k].arg}' es de tipo ${t}.`);
    }
  }

  // 7) Build output schema. Group-by cols first, then aggregate columns.
  const outCols: Column[] = [
    ...gbCols.map((c, k) => ({ name: c, type: baseRel.columns[gbIdx[k]].type })),
    ...aggs.map((a, k) => ({ name: a.alias, type: aggOutputType(a, baseRel.columns, argIdx[k]) })),
  ];

  // 8) Empty input + global aggregation → emit one row with neutral values.
  if (baseRel.rows.length === 0 && gbCols.length === 0) {
    const row: Value[] = aggs.map(a => (a.func === 'count' || a.func === 'sum') ? 0 : null);
    return { result: { columns: outCols, rows: [row] }, note: buildNote(aggs, gbCols, rest) };
  }

  // 9) Group rows preserving first-seen order.
  const groups = new Map<string, Value[][]>();
  const order: string[] = [];
  const gvals = new Map<string, Value[]>();
  for (const row of baseRel.rows) {
    const gv = gbIdx.map(i => row[i]);
    const key = groupKey(gv);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
      gvals.set(key, gv);
    }
    groups.get(key)!.push(row);
  }

  // 10) Compute aggregates per group.
  const outRows: Value[][] = [];
  for (const key of order) {
    const groupRows = groups.get(key)!;
    const gv = gvals.get(key)!;
    const aggVals: Value[] = aggs.map((a, k) => computeAgg(a, argIdx[k], groupRows));
    outRows.push([...gv, ...aggVals]);
  }

  return { result: { columns: outCols, rows: outRows }, note: buildNote(aggs, gbCols, rest) };
}

function aggOutputType(a: AggCall, srcCols: Column[], argIdx: number): ColumnType {
  if (a.func === 'count' || a.func === 'sum' || a.func === 'avg') return 'number';
  // min/max preserve source column type
  return argIdx >= 0 ? srcCols[argIdx].type : 'number';
}

function computeAgg(a: AggCall, argIdx: number, rows: Value[][]): Value {
  if (a.func === 'count') {
    if (a.arg === '*') return rows.length;
    return rows.reduce((n, r) => (r[argIdx] !== null && r[argIdx] !== undefined ? n + 1 : n), 0);
  }
  // sum / avg / min / max — filter nulls first
  const vals: Value[] = [];
  for (const r of rows) {
    const v = r[argIdx];
    if (v !== null && v !== undefined) vals.push(v);
  }
  if (vals.length === 0) return null;
  if (a.func === 'sum') return vals.reduce<number>((s, v) => s + (v as number), 0);
  if (a.func === 'avg') {
    const sum = vals.reduce<number>((s, v) => s + (v as number), 0);
    return sum / vals.length;
  }
  if (a.func === 'min') return vals.reduce((m, v) => (compareLT(v, m) ? v : m));
  return vals.reduce((m, v) => (compareLT(m, v) ? v : m)); // max
}

function compareLT(a: Value, b: Value): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() < b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) < (b ? 1 : 0);
  return String(a) < String(b);
}

function groupKey(vals: Value[]): string {
  return vals.map(v => {
    if (v === null || v === undefined) return ' NULL';
    if (v instanceof Date) return `D${v.getTime()}`;
    if (typeof v === 'number') return `N${v}`;
    if (typeof v === 'boolean') return v ? 'T' : 'F';
    return `S${v}`;
  }).join('|');
}

function buildNote(aggs: AggCall[], gbCols: string[], fromText: string): string {
  const aggDesc = aggs.map(a => `${a.func}(${a.arg})→${a.alias}`).join(', ');
  if (gbCols.length === 0) {
    return aggs.length > 0
      ? `SQL agregado global sobre ${fromText}: ${aggDesc}`
      : `SQL sobre ${fromText}`;
  }
  return `SQL agrupado por ${gbCols.join(', ')} sobre ${fromText}${aggs.length ? `: ${aggDesc}` : ''}`;
}

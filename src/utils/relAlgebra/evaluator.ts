// Evaluator — turns an AST + a relation environment into a Relation.

import type {
  AggCall,
  CmpOp,
  Column,
  ColumnType,
  Condition,
  CondOperand,
  Program,
  RelExpr,
  Relation,
  Value,
} from './types';
import { RAError } from './types';

export interface EvalResult {
  // The relation produced by the LAST expression statement (if any).
  result: Relation | null;
  // All bindings introduced via `:=`, in order of appearance.
  derived: Map<string, Relation>;
  // Per-AST-node intermediate results, keyed by node identity. Used by the UI
  // to render an execution tree where each node shows its row count and the
  // user can click to see the intermediate relation.
  trace: Map<RelExpr, Relation>;
}

/**
 * Evaluate a parsed program against an environment of named relations.
 *
 * @param program AST returned by parse()
 * @param env Map from relation name → Relation (base tables + previously-derived)
 *
 * Derived relations introduced via `R := …` are added to a fresh local
 * environment so they don't leak into the caller's map, but they are returned
 * separately for the UI to display.
 */
export function evaluate(program: Program, env: Map<string, Relation>): EvalResult {
  const local = new Map(env);
  const derived = new Map<string, Relation>();
  const trace = new Map<RelExpr, Relation>();
  let last: Relation | null = null;

  for (const stmt of program.statements) {
    if (stmt.kind === 'assign') {
      const rel = evalExpr(stmt.expr, local, trace);
      if (local.has(stmt.name) && !derived.has(stmt.name)) {
        // Name collides with a base table — that's a hard error.
        throw new RAError(
          `'${stmt.name}' ya existe como tabla base. Elegí otro nombre para la asignación.`,
          stmt.pos
        );
      }
      local.set(stmt.name, rel);
      derived.set(stmt.name, rel);
      last = rel;
    } else {
      last = evalExpr(stmt.expr, local, trace);
    }
  }
  return { result: last, derived, trace };
}

function evalExpr(expr: RelExpr, env: Map<string, Relation>, trace: Map<RelExpr, Relation>): Relation {
  let rel: Relation;
  switch (expr.kind) {
    case 'ref': {
      const r = env.get(expr.name);
      if (!r) throw new RAError(`Relación '${expr.name}' no encontrada.`, expr.pos);
      rel = r;
      break;
    }
    case 'select':
      rel = doSelect(evalExpr(expr.child, env, trace), expr.condition);
      break;
    case 'project':
      rel = doProject(evalExpr(expr.child, env, trace), expr.columns, expr.pos);
      break;
    case 'rename':
      rel = doRename(evalExpr(expr.child, env, trace), expr.alias, expr.columnMap, expr.pos);
      break;
    case 'aggregate':
      rel = doAggregate(evalExpr(expr.child, env, trace), expr.groupBy, expr.aggs, expr.pos);
      break;
    case 'binary': {
      const L = evalExpr(expr.left, env, trace);
      const R = evalExpr(expr.right, env, trace);
      const Lname = relNameOf(expr.left);
      const Rname = relNameOf(expr.right);
      switch (expr.op) {
        case 'cross': rel = doCross(L, R, Lname, Rname); break;
        case 'join':  rel = doNaturalJoin(L, R); break;
        case 'theta': {
          const cross = doCross(L, R, Lname, Rname);
          rel = doSelect(cross, expr.condition!);
          break;
        }
        case 'union':      rel = doUnion(L, R, expr.pos); break;
        case 'intersect':  rel = doIntersect(L, R, expr.pos); break;
        case 'difference': rel = doDifference(L, R, expr.pos); break;
        case 'division':   rel = doDivision(L, R, expr.pos); break;
      }
      break;
    }
  }
  trace.set(expr, rel!);
  return rel!;
}

/** Returns the original relation name if expr is a simple reference, else undefined. */
function relNameOf(expr: RelExpr): string | undefined {
  if (expr.kind === 'ref') return expr.name;
  if (expr.kind === 'rename' && expr.alias) return expr.alias;
  return undefined;
}

// ----- σ -----

function doSelect(rel: Relation, cond: Condition): Relation {
  const rows = rel.rows.filter(row => evalCondition(cond, row, rel.columns));
  return { columns: rel.columns, rows };
}

function evalCondition(cond: Condition, row: Value[], cols: Column[]): boolean {
  switch (cond.kind) {
    case 'and': return evalCondition(cond.left, row, cols) && evalCondition(cond.right, row, cols);
    case 'or':  return evalCondition(cond.left, row, cols) || evalCondition(cond.right, row, cols);
    case 'not': return !evalCondition(cond.child, row, cols);
    case 'cmp': {
      const lv = resolveOperand(cond.left, row, cols);
      const rv = resolveOperand(cond.right, row, cols);
      const lt = typeOfOperand(cond.left, cols);
      const rt = typeOfOperand(cond.right, cols);
      const targetType = lt === 'string' || rt === 'string'
        ? (lt !== 'string' ? lt : rt)
        : lt;
      const a = coerceForCompare(lv, targetType);
      const b = coerceForCompare(rv, targetType);
      return compareValues(a, b, cond.op);
    }
  }
}

/**
 * Find a column by name. Accepts both qualified (R.col) and unqualified (col)
 * names. An unqualified name matches a qualified column ONLY if it's unambiguous:
 * "col" matches "R.col" iff no other column ends in ".col" and no plain "col" exists
 * with a different position. Throws on ambiguity.
 */
function findColIdx(cols: Column[], name: string, pos: import('./types').SrcPos): number {
  // 1. Exact match first.
  for (let i = 0; i < cols.length; i++) if (cols[i].name === name) return i;

  // 2. Unqualified requested name → match any column whose suffix is ".name".
  //    E.g. "id" matches "usuario.id". Ambiguous if more than one match.
  if (!name.includes('.')) {
    const matches: number[] = [];
    for (let i = 0; i < cols.length; i++) {
      if (cols[i].name.endsWith('.' + name)) matches.push(i);
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const cands = matches.map(i => cols[i].name).join(', ');
      throw new RAError(`Columna '${name}' es ambigua: posibles ${cands}.`, pos);
    }
    throw new RAError(`Columna '${name}' no encontrada.`, pos);
  }

  // 3. Qualified requested name (R.col) with no exact column → fall back to the
  //    bare column "col" if it exists and is unique. Handles cross-product cases
  //    where only one side contributed a column with that name, so no prefix
  //    was added.
  const base = name.slice(name.indexOf('.') + 1);
  const matches: number[] = [];
  for (let i = 0; i < cols.length; i++) {
    if (cols[i].name === base) matches.push(i);
  }
  if (matches.length === 1) return matches[0];
  throw new RAError(`Columna '${name}' no encontrada.`, pos);
}

function resolveOperand(op: CondOperand, row: Value[], cols: Column[]): Value {
  if (op.kind === 'lit') return op.value;
  return row[findColIdx(cols, op.name, op.pos)];
}

function typeOfOperand(op: CondOperand, cols: Column[]): ColumnType {
  if (op.kind === 'col') return cols[findColIdx(cols, op.name, op.pos)].type;
  return op.valueType;
}

function coerceForCompare(v: Value, target: ColumnType): Value {
  if (v === null || v === undefined) return null;
  if (target === 'number') {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    }
    if (v instanceof Date) return v.getTime();
    return v;
  }
  if (target === 'date') {
    if (v instanceof Date) return v;
    if (typeof v === 'string') {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? v : d;
    }
    return v;
  }
  if (target === 'boolean') {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.toLowerCase() === 'true';
    return v;
  }
  // string
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function compareValues(a: Value, b: Value, op: CmpOp): boolean {
  if (a === null || b === null) {
    // Null semantics: equality and inequality with null → false (SQL-like).
    return op === '!=' ? a !== b : false;
  }
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  switch (op) {
    case '=':  return av === bv;
    case '!=': return av !== bv;
    case '<':  return (av as number) < (bv as number);
    case '>':  return (av as number) > (bv as number);
    case '<=': return (av as number) <= (bv as number);
    case '>=': return (av as number) >= (bv as number);
  }
}

// ----- π -----

function doProject(rel: Relation, cols: string[], pos: import('./types').SrcPos): Relation {
  const indices = cols.map(name => findColIdx(rel.columns, name, pos));
  // Project keeps the column names AS REQUESTED — if user asked for "R.col"
  // the output column is "R.col"; if they asked for "col" the output is "col".
  // This matches Ramakrishnan's convention that projection is over a list of names.
  const newCols: Column[] = indices.map((i, k) => ({ name: cols[k], type: rel.columns[i].type }));
  const seen = new Set<string>();
  const rows: Value[][] = [];
  for (const row of rel.rows) {
    const projected = indices.map(i => row[i]);
    const key = tupleKey(projected);
    if (!seen.has(key)) {
      seen.add(key);
      rows.push(projected);
    }
  }
  return { columns: newCols, rows };
}

// ----- ρ -----

/**
 * Rename. Two forms:
 *  - alias-only: ρ_{NewName}(R) — re-tags the relation. If columns are
 *    qualified with the old relation name (R.col), they become NewName.col.
 *  - columnMap: ρ_{a→a1, b→b1}(R) — renames individual columns.
 */
function doRename(
  rel: Relation,
  alias: string | undefined,
  columnMap: Record<string, string> | undefined,
  pos: import('./types').SrcPos,
): Relation {
  if (columnMap) {
    // Validate that every requested rename refers to an existing column.
    for (const from of Object.keys(columnMap)) {
      const exists = rel.columns.some(c => c.name === from || c.name.endsWith('.' + from));
      if (!exists) throw new RAError(`No se puede renombrar: columna '${from}' no existe.`, pos);
    }
    const newCols = rel.columns.map(c => {
      // Direct match
      if (Object.prototype.hasOwnProperty.call(columnMap, c.name)) {
        return { name: columnMap[c.name], type: c.type };
      }
      // Unqualified-suffix match
      const idx = c.name.indexOf('.');
      if (idx >= 0) {
        const tail = c.name.slice(idx + 1);
        if (Object.prototype.hasOwnProperty.call(columnMap, tail)) {
          return { name: columnMap[tail], type: c.type };
        }
      }
      return c;
    });
    return { columns: newCols, rows: rel.rows.map(r => [...r]) };
  }

  if (alias) {
    // Re-tag qualified columns under the new alias. Unqualified columns become
    // qualified under the alias so that downstream theta-joins can reference
    // them as alias.col.
    const newCols = rel.columns.map(c => {
      const dot = c.name.indexOf('.');
      const local = dot >= 0 ? c.name.slice(dot + 1) : c.name;
      return { name: `${alias}.${local}`, type: c.type };
    });
    return { columns: newCols, rows: rel.rows.map(r => [...r]) };
  }
  return rel;
}

// ----- ⨯ -----

/**
 * Ramakrishnan, Cap 4: cross product concatenates tuples. On name collision,
 * the convention is to prefix with the source relation name (R.a, S.a). If
 * either side's relation name isn't known (e.g. it's a sub-expression), fall
 * back to a positional suffix so output stays unambiguous.
 */
function doCross(L: Relation, R: Relation, Lname?: string, Rname?: string): Relation {
  const lNames = new Set(L.columns.map(c => c.name));
  const collisions = new Set(R.columns.filter(c => lNames.has(c.name)).map(c => c.name));

  const renameLeft = (c: Column): Column =>
    collisions.has(c.name) && Lname ? { name: `${Lname}.${c.name}`, type: c.type } : c;
  const renameRight = (c: Column): Column => {
    if (!collisions.has(c.name)) return c;
    if (Rname) return { name: `${Rname}.${c.name}`, type: c.type };
    return { name: `${c.name}_2`, type: c.type };
  };

  const cols: Column[] = [
    ...L.columns.map(renameLeft),
    ...R.columns.map(renameRight),
  ];
  const rows: Value[][] = [];
  for (const lr of L.rows) for (const rr of R.rows) rows.push([...lr, ...rr]);
  return { columns: cols, rows };
}

// ----- ⋈ (natural join) -----

function doNaturalJoin(L: Relation, R: Relation): Relation {
  const common: { lIdx: number; rIdx: number; name: string }[] = [];
  for (let i = 0; i < L.columns.length; i++) {
    const j = R.columns.findIndex(c => c.name === L.columns[i].name);
    if (j >= 0) common.push({ lIdx: i, rIdx: j, name: L.columns[i].name });
  }
  if (common.length === 0) {
    // Natural join with no common columns degenerates to cross product.
    return doCross(L, R);
  }
  const rightExtraIdx = R.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !common.some(k => k.name === c.name))
    .map(({ i }) => i);
  const cols: Column[] = [
    ...L.columns,
    ...rightExtraIdx.map(i => R.columns[i]),
  ];
  // Hash join: group R by common-key tuple.
  const hash = new Map<string, Value[][]>();
  for (const rr of R.rows) {
    const k = tupleKey(common.map(c => rr[c.rIdx]));
    if (!hash.has(k)) hash.set(k, []);
    hash.get(k)!.push(rr);
  }
  const rows: Value[][] = [];
  for (const lr of L.rows) {
    const k = tupleKey(common.map(c => lr[c.lIdx]));
    const matches = hash.get(k);
    if (!matches) continue;
    for (const rr of matches) {
      rows.push([...lr, ...rightExtraIdx.map(i => rr[i])]);
    }
  }
  return { columns: cols, rows };
}

// ----- ∪ ∩ - (Ramakrishnan union-compatibility: same arity + same domains, NOT same names) -----

/**
 * Ramakrishnan & Gehrke, Chapter 4:
 *   "Two relations are union-compatible if they have the same number of fields,
 *    and corresponding fields, taken in order from left to right, have the same domains."
 *
 * The result adopts the names of the LEFT operand.
 */
function assertUnionCompatible(L: Relation, R: Relation, pos: import('./types').SrcPos): void {
  if (L.columns.length !== R.columns.length) {
    throw new RAError(
      `Relaciones no compatibles: distinta aridad (${L.columns.length} ≠ ${R.columns.length}).`,
      pos
    );
  }
  for (let i = 0; i < L.columns.length; i++) {
    if (L.columns[i].type !== R.columns[i].type) {
      throw new RAError(
        `Columna ${i + 1}: dominios incompatibles ('${L.columns[i].name}': ${L.columns[i].type} ≠ '${R.columns[i].name}': ${R.columns[i].type}).`,
        pos
      );
    }
  }
}

function doUnion(L: Relation, R: Relation, pos: import('./types').SrcPos): Relation {
  assertUnionCompatible(L, R, pos);
  const seen = new Set<string>();
  const rows: Value[][] = [];
  for (const r of [...L.rows, ...R.rows]) {
    const k = tupleKey(r);
    if (!seen.has(k)) { seen.add(k); rows.push(r); }
  }
  return { columns: L.columns, rows };
}

function doIntersect(L: Relation, R: Relation, pos: import('./types').SrcPos): Relation {
  assertUnionCompatible(L, R, pos);
  const rSet = new Set(R.rows.map(tupleKey));
  const seen = new Set<string>();
  const rows: Value[][] = [];
  for (const r of L.rows) {
    const k = tupleKey(r);
    if (rSet.has(k) && !seen.has(k)) { seen.add(k); rows.push(r); }
  }
  return { columns: L.columns, rows };
}

function doDifference(L: Relation, R: Relation, pos: import('./types').SrcPos): Relation {
  assertUnionCompatible(L, R, pos);
  const rSet = new Set(R.rows.map(tupleKey));
  const seen = new Set<string>();
  const rows: Value[][] = [];
  for (const r of L.rows) {
    const k = tupleKey(r);
    if (!rSet.has(k) && !seen.has(k)) { seen.add(k); rows.push(r); }
  }
  return { columns: L.columns, rows };
}

// ----- ÷ (division) -----

/**
 * Ramakrishnan & Gehrke, Cap 4 — Division.
 *
 * R ÷ S returns tuples t over the schema (R − S) such that for every tuple
 * s ∈ S, the tuple t·s appears in R. Pre-condition: S's schema must be a
 * subset of R's schema (by column name and type).
 *
 * Typical use case: "find usuarios who placed orders for ALL products in S".
 */
function doDivision(R: Relation, S: Relation, pos: import('./types').SrcPos): Relation {
  // 1) Validate S schema ⊆ R schema.
  for (let i = 0; i < S.columns.length; i++) {
    const sCol = S.columns[i];
    const rCol = R.columns.find(c => c.name === sCol.name);
    if (!rCol) {
      throw new RAError(
        `División: la columna '${sCol.name}' de S no existe en R. S debe ser un subconjunto del esquema de R.`,
        pos,
      );
    }
    if (rCol.type !== sCol.type) {
      throw new RAError(
        `División: tipo incompatible en columna '${sCol.name}' (R: ${rCol.type}, S: ${sCol.type}).`,
        pos,
      );
    }
  }
  if (S.columns.length === R.columns.length) {
    throw new RAError(
      `División: S debe ser un subconjunto ESTRICTO del esquema de R (al menos una columna en R que no esté en S).`,
      pos,
    );
  }

  // 2) Compute result schema A = R.columns − S.columns
  const sNames = new Set(S.columns.map(c => c.name));
  const aCols: Column[] = R.columns.filter(c => !sNames.has(c.name));
  const aIdxInR = aCols.map(c => R.columns.findIndex(rc => rc.name === c.name));
  const sIdxInR = S.columns.map(sc => R.columns.findIndex(rc => rc.name === sc.name));

  // 3) Build fast lookup of R rows.
  const rKeys = new Set(R.rows.map(tupleKey));

  // 4) Compute unique projections of R onto A.
  const aProjMap = new Map<string, Value[]>();
  for (const row of R.rows) {
    const a = aIdxInR.map(i => row[i]);
    const k = tupleKey(a);
    if (!aProjMap.has(k)) aProjMap.set(k, a);
  }

  // 5) For each candidate `a`, verify that ∀s∈S, (a·s reassembled in R order) ∈ R.
  const rows: Value[][] = [];
  for (const a of aProjMap.values()) {
    let allPresent = true;
    for (const s of S.rows) {
      const candidate: Value[] = new Array(R.columns.length).fill(null);
      aIdxInR.forEach((ri, k) => { candidate[ri] = a[k]; });
      sIdxInR.forEach((ri, k) => { candidate[ri] = s[k]; });
      if (!rKeys.has(tupleKey(candidate))) { allPresent = false; break; }
    }
    if (allPresent) rows.push(a);
  }

  return { columns: aCols, rows };
}

// ----- γ (group + aggregate) -----

/**
 * Group rows by groupBy columns (possibly empty for global aggregation),
 * then compute each aggregate over the rows in each group.
 *
 * Semantics:
 *  - count(*)   counts tuples (nulls included).
 *  - count(c)   counts non-null values of c.
 *  - sum/avg    over non-null values; if all null → null.
 *  - min/max    over non-null values; if all null → null.
 *  - Empty input + no groupBy → one row with count/sum=0, min/max/avg=null.
 *  - Empty input + groupBy    → zero rows.
 *
 * Output column order: groupBy columns first, then aggregate columns in the
 * order they appeared in the syntax. Aggregate column types follow standard
 * SQL conventions: count/sum/avg → number; min/max → preserve source type.
 */
function doAggregate(
  rel: Relation,
  groupBy: string[],
  aggs: AggCall[],
  pos: import('./types').SrcPos,
): Relation {
  const groupIdx = groupBy.map(c => findColIdx(rel.columns, c, pos));
  // -1 marks `count(*)` (no column dependency); other aggs resolve their col.
  const argIdx = aggs.map(a => (a.arg === '*' ? -1 : findColIdx(rel.columns, a.arg, pos)));

  // Validate non-count aggregates only run on numeric columns when arithmetic
  // is involved (sum / avg). min/max are permissive (numbers, dates, strings).
  for (let k = 0; k < aggs.length; k++) {
    const a = aggs[k];
    if (a.arg === '*') continue;
    const srcType = rel.columns[argIdx[k]].type;
    if ((a.func === 'sum' || a.func === 'avg') && srcType !== 'number') {
      throw new RAError(
        `${a.func}() requiere una columna numérica; '${a.arg}' es de tipo ${srcType}.`,
        a.pos
      );
    }
  }

  // Output schema. Build it once — types don't depend on the data.
  const outCols: Column[] = [
    ...groupIdx.map((i, k) => ({ name: groupBy[k], type: rel.columns[i].type })),
    ...aggs.map((a, k) => ({ name: a.alias, type: typeForAgg(a, rel.columns, argIdx[k]) })),
  ];

  // Group rows. Preserve first-occurrence order for stable output.
  const groups = new Map<string, Value[][]>();
  const order: string[] = [];
  const groupVals = new Map<string, Value[]>();
  for (const row of rel.rows) {
    const gvals = groupIdx.map(i => row[i]);
    const key = tupleKey(gvals);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
      groupVals.set(key, gvals);
    }
    groups.get(key)!.push(row);
  }

  // Special case: empty relation + global aggregation → emit a single row.
  if (rel.rows.length === 0 && groupBy.length === 0) {
    const row: Value[] = aggs.map(a => {
      if (a.func === 'count') return 0;
      if (a.func === 'sum') return 0;
      return null;
    });
    return { columns: outCols, rows: [row] };
  }

  // For each group, compute aggregates.
  const outRows: Value[][] = [];
  for (const key of order) {
    const groupRows = groups.get(key)!;
    const gvals = groupVals.get(key)!;
    const aggVals: Value[] = aggs.map((a, k) => {
      const ai = argIdx[k];
      if (a.func === 'count') {
        if (a.arg === '*') return groupRows.length;
        return groupRows.reduce((n, r) => (r[ai] !== null && r[ai] !== undefined ? n + 1 : n), 0);
      }
      // sum/avg/min/max: filter nulls first
      const vals: Value[] = [];
      for (const r of groupRows) {
        const v = r[ai];
        if (v !== null && v !== undefined) vals.push(v);
      }
      if (vals.length === 0) return null;
      if (a.func === 'sum') {
        return vals.reduce<number>((s, v) => s + (v as number), 0);
      }
      if (a.func === 'avg') {
        const sum = vals.reduce<number>((s, v) => s + (v as number), 0);
        return sum / vals.length;
      }
      if (a.func === 'min') {
        return vals.reduce((m, v) => (compareLT(v, m) ? v : m));
      }
      // max
      return vals.reduce((m, v) => (compareLT(m, v) ? v : m));
    });
    outRows.push([...gvals, ...aggVals]);
  }

  return { columns: outCols, rows: outRows };
}

/** Aggregate output type per Ramakrishnan §5.5. */
function typeForAgg(a: AggCall, srcCols: Column[], argIdx: number): ColumnType {
  if (a.func === 'count') return 'number';
  if (a.func === 'sum' || a.func === 'avg') return 'number';
  // min/max preserve source column type
  if (argIdx < 0) return 'number';
  return srcCols[argIdx].type;
}

/** Cross-type less-than for min/max. Numbers and dates compare numerically;
 *  strings lexicographically; booleans as 0/1. Nulls were filtered upstream. */
function compareLT(a: Value, b: Value): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() < b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) < (b ? 1 : 0);
  return String(a) < String(b);
}

// ----- tuple key for dedup/lookup -----

function tupleKey(row: Value[]): string {
  return row.map(v => {
    if (v === null || v === undefined) return ' NULL';
    if (v instanceof Date) return `D${v.getTime()}`;
    if (typeof v === 'number') return `N${v}`;
    if (typeof v === 'boolean') return v ? 'T' : 'F';
    return `S${v}`;
  }).join('');
}

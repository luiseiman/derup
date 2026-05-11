// Evaluator — turns an AST + a relation environment into a Relation.

import type {
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
  let last: Relation | null = null;

  for (const stmt of program.statements) {
    if (stmt.kind === 'assign') {
      const rel = evalExpr(stmt.expr, local);
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
      last = evalExpr(stmt.expr, local);
    }
  }
  return { result: last, derived };
}

function evalExpr(expr: RelExpr, env: Map<string, Relation>): Relation {
  switch (expr.kind) {
    case 'ref': {
      const r = env.get(expr.name);
      if (!r) throw new RAError(`Relación '${expr.name}' no encontrada.`, expr.pos);
      return r;
    }
    case 'select':
      return doSelect(evalExpr(expr.child, env), expr.condition);
    case 'project':
      return doProject(evalExpr(expr.child, env), expr.columns, expr.pos);
    case 'rename':
      return doRename(evalExpr(expr.child, env), expr.columnMap, expr.pos);
    case 'binary': {
      const L = evalExpr(expr.left, env);
      const R = evalExpr(expr.right, env);
      switch (expr.op) {
        case 'cross': return doCross(L, R);
        case 'join': return doNaturalJoin(L, R);
        case 'union': return doUnion(L, R, expr.pos);
        case 'intersect': return doIntersect(L, R, expr.pos);
        case 'difference': return doDifference(L, R, expr.pos);
      }
    }
  }
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

function resolveOperand(op: CondOperand, row: Value[], cols: Column[]): Value {
  if (op.kind === 'lit') return op.value;
  const idx = cols.findIndex(c => c.name === op.name);
  if (idx < 0) throw new RAError(`Columna '${op.name}' no encontrada.`, op.pos);
  return row[idx];
}

function typeOfOperand(op: CondOperand, cols: Column[]): ColumnType {
  if (op.kind === 'col') {
    const c = cols.find(c => c.name === op.name);
    if (!c) throw new RAError(`Columna '${op.name}' no encontrada.`, op.pos);
    return c.type;
  }
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
  const indices = cols.map(name => {
    const i = rel.columns.findIndex(c => c.name === name);
    if (i < 0) throw new RAError(`Columna '${name}' no existe en la relación.`, pos);
    return i;
  });
  const newCols: Column[] = indices.map(i => rel.columns[i]);
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

function doRename(rel: Relation, columnMap: Record<string, string> | undefined, pos: import('./types').SrcPos): Relation {
  if (!columnMap) return rel; // alias-only rename is a no-op on Relation contents
  const newCols = rel.columns.map(c => {
    if (Object.prototype.hasOwnProperty.call(columnMap, c.name)) {
      return { name: columnMap[c.name], type: c.type };
    }
    return c;
  });
  // Validate that every requested rename refers to an existing column
  for (const from of Object.keys(columnMap)) {
    if (!rel.columns.some(c => c.name === from)) {
      throw new RAError(`No se puede renombrar: columna '${from}' no existe.`, pos);
    }
  }
  return { columns: newCols, rows: rel.rows.map(r => [...r]) };
}

// ----- ⨯ -----

function doCross(L: Relation, R: Relation): Relation {
  // On column-name collision, prefix with index to keep them distinguishable.
  const lNames = new Set(L.columns.map(c => c.name));
  const cols: Column[] = [
    ...L.columns,
    ...R.columns.map(c => lNames.has(c.name) ? { name: `${c.name}_2`, type: c.type } : c),
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

// ----- ∪ ∩ - (require same schema) -----

function assertSameSchema(L: Relation, R: Relation, pos: import('./types').SrcPos): void {
  if (L.columns.length !== R.columns.length) {
    throw new RAError(
      `Las relaciones deben tener el mismo número de columnas (${L.columns.length} ≠ ${R.columns.length}).`,
      pos
    );
  }
  for (let i = 0; i < L.columns.length; i++) {
    if (L.columns[i].name !== R.columns[i].name) {
      throw new RAError(
        `Los nombres de columna deben coincidir en orden: '${L.columns[i].name}' ≠ '${R.columns[i].name}'.`,
        pos
      );
    }
  }
}

function doUnion(L: Relation, R: Relation, pos: import('./types').SrcPos): Relation {
  assertSameSchema(L, R, pos);
  const seen = new Set<string>();
  const rows: Value[][] = [];
  for (const r of [...L.rows, ...R.rows]) {
    const k = tupleKey(r);
    if (!seen.has(k)) { seen.add(k); rows.push(r); }
  }
  return { columns: L.columns, rows };
}

function doIntersect(L: Relation, R: Relation, pos: import('./types').SrcPos): Relation {
  assertSameSchema(L, R, pos);
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
  assertSameSchema(L, R, pos);
  const rSet = new Set(R.rows.map(tupleKey));
  const seen = new Set<string>();
  const rows: Value[][] = [];
  for (const r of L.rows) {
    const k = tupleKey(r);
    if (!rSet.has(k) && !seen.has(k)) { seen.add(k); rows.push(r); }
  }
  return { columns: L.columns, rows };
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

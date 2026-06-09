// SQL engine — embeds sql.js (SQLite compiled to WASM) so the SQL tab runs
// real SQL against the user's loaded relations. SQLite covers ~95% of the
// SQL surface a student needs (SELECT/INSERT/UPDATE/DELETE, JOINs, subqueries,
// CTEs, window functions, aggregates, ORDER BY, LIMIT, HAVING, UNION, …).
//
// Lifecycle:
//   1. initSqlEngine() — loads the WASM once, returns a cached engine.
//   2. engine.execute(sql, env) — syncs the env relations into SQLite tables
//      (drop + create + insert each time, cheap for educational datasets),
//      runs the SQL, and maps the result back to a Relation.

import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic } from 'sql.js';
// Vite picks this up and emits the WASM as a hashed asset under /assets/.
// At runtime we feed the resolved URL to initSqlJs via locateFile.
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { Column, ColumnType, Relation, Value } from './relAlgebra/types';

let cached: Promise<SqlEngine> | null = null;

/** Get (or lazily create) the shared SQL engine. Subsequent calls return the
 *  same instance — sql.js only needs to download/compile the WASM once. */
export function initSqlEngine(): Promise<SqlEngine> {
  if (!cached) cached = createEngine();
  return cached;
}

async function createEngine(): Promise<SqlEngine> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  return new SqlEngine(SQL);
}

export interface SqlExecResult {
  /** The relation produced by the SQL. For multi-statement scripts, this is
   *  the result of the LAST statement that produced rows (mirrors the algebra
   *  evaluator's semantics). */
  result: Relation | null;
  /** Number of rows affected by the last DML statement (INSERT/UPDATE/DELETE),
   *  if any. Null when the statement was a SELECT or DDL. */
  rowsAffected: number | null;
  /** Wall-clock ms taken to execute. */
  ms: number;
}

export class SqlEngine {
  private SQL: SqlJsStatic;
  /** Schema cache so we can recover types in the result. Each known table is
   *  remembered with its declared column types. */
  private schemas = new Map<string, Column[]>();

  constructor(SQL: SqlJsStatic) {
    this.SQL = SQL;
  }

  /**
   * Execute a SQL string against a fresh SQLite database materialised from
   * `env`. Each call gets its own DB so failed statements don't leave the
   * engine in a corrupted state.
   *
   * Multi-statement scripts are allowed (separated by ';'). The result of
   * the last statement that produced rows is returned.
   */
  execute(sql: string, env: Map<string, Relation>): SqlExecResult {
    const t0 = performance.now();
    const db = new this.SQL.Database();
    this.schemas.clear();
    try {
      this.syncEnv(db, env);
      const stmts = sql
        .split('\n')
        .map(l => l.replace(/--.*$/, ''))
        .join('\n');

      // sql.js's exec() returns an array of result sets — one per
      // statement that produced rows. db.run() is for statements that
      // don't return rows but exposes a uniform path.
      const sets = db.exec(stmts);
      const rowsAffected = db.getRowsModified() || null;

      if (sets.length === 0) {
        return { result: null, rowsAffected, ms: Math.max(1, Math.round(performance.now() - t0)) };
      }
      // Use the last SELECT-like result set.
      const last = sets[sets.length - 1];
      const result = this.toRelation(last);
      return { result, rowsAffected, ms: Math.max(1, Math.round(performance.now() - t0)) };
    } finally {
      db.close();
    }
  }

  /** Drop & recreate every table in env, then bulk-insert its rows. */
  private syncEnv(db: Database, env: Map<string, Relation>): void {
    for (const [name, rel] of env.entries()) {
      if (!isValidIdent(name)) continue; // skip names SQLite can't quote safely
      this.schemas.set(name, rel.columns);
      const cols = rel.columns.map(c => `"${c.name}" ${sqliteTypeOf(c.type)}`).join(', ');
      db.run(`DROP TABLE IF EXISTS "${name}";`);
      db.run(`CREATE TABLE "${name}" (${cols});`);
      if (rel.rows.length === 0) continue;
      const placeholders = rel.columns.map(() => '?').join(', ');
      const stmt = db.prepare(`INSERT INTO "${name}" VALUES (${placeholders});`);
      try {
        for (const row of rel.rows) {
          stmt.run(row.map(v => toSqlite(v)));
        }
      } finally {
        stmt.free();
      }
    }
  }

  /** Map a sql.js result set { columns, values } to derup's Relation shape.
   *  Recovers original column types when result-column names match a known
   *  source column; otherwise infers from the first non-null value. */
  private toRelation(set: { columns: string[]; values: Array<Array<unknown>> }): Relation {
    const columns: Column[] = set.columns.map((name, ci) => ({
      name,
      type: this.recoverType(name, set.values, ci),
    }));
    const rows: Value[][] = set.values.map(row =>
      row.map((v, ci) => fromSqlite(v, columns[ci].type))
    );
    return { columns, rows };
  }

  private recoverType(name: string, rows: Array<Array<unknown>>, ci: number): ColumnType {
    // Step 1 — does a column with this exact name exist in any synced table?
    let candidate: ColumnType | null = null;
    for (const cols of this.schemas.values()) {
      const hit = cols.find(c => c.name === name);
      if (hit) { candidate = hit.type; break; }
    }
    // Step 2 — suffix qualifier (e.g. "emp.eid" produced by a join column).
    if (!candidate) {
      const dotIdx = name.indexOf('.');
      if (dotIdx >= 0) {
        const tail = name.slice(dotIdx + 1);
        for (const cols of this.schemas.values()) {
          const hit = cols.find(c => c.name === tail);
          if (hit) { candidate = hit.type; break; }
        }
      }
    }

    // Step 3 — if we got a candidate, VERIFY it against the actual values.
    // SQLite is laxly typed (type affinity) and a query like
    //   SELECT eid FROM emp UNION ALL SELECT ename FROM emp
    // returns rows whose 'eid' column mixes numbers and strings. Forcing
    // those strings to 'number' downstream would coerce them to NaN→null
    // and the user would see Ø where they expect "Ana", "Beto", etc.
    // When the schema type doesn't fit ALL non-null values, fall back to
    // 'string' which round-trips everything verbatim.
    if (candidate && candidate !== 'string') {
      let fits = true;
      for (const row of rows) {
        const v = row[ci];
        if (v === null || v === undefined) continue;
        if (!valueFitsType(v, candidate)) { fits = false; break; }
      }
      if (fits) return candidate;
      return 'string';
    }
    if (candidate) return candidate;

    // Step 4 — no schema match: infer from the first non-null value.
    for (const row of rows) {
      const v = row[ci];
      if (v === null || v === undefined) continue;
      if (typeof v === 'number') return 'number';
      if (typeof v === 'boolean') return 'boolean';
      if (typeof v === 'string') {
        // Heuristic: ISO-ish dates → 'date'. Otherwise string.
        if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) return 'date';
        return 'string';
      }
    }
    return 'string';
  }
}

/** Does the runtime value `v` match the declared ColumnType `t`?
 *  Used to detect SQLite type-affinity surprises (mixed types in a UNION-ALL
 *  column, for instance) so we can fall back to 'string' instead of forcing
 *  a doomed conversion in fromSqlite. */
function valueFitsType(v: unknown, t: ColumnType): boolean {
  if (v === null || v === undefined) return true; // null is universal
  if (t === 'number') return typeof v === 'number';
  if (t === 'boolean') {
    if (typeof v === 'boolean') return true;
    // SQLite stores booleans as 0/1 integers — those are still "fits".
    return typeof v === 'number' && (v === 0 || v === 1);
  }
  if (t === 'date') {
    if (v instanceof Date) return true;
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
  }
  // 'string' is the universal fallback — anything serialises into it.
  return true;
}

function sqliteTypeOf(t: ColumnType): string {
  switch (t) {
    case 'number': return 'REAL';
    case 'boolean': return 'INTEGER';
    case 'date': return 'TEXT';
    case 'string': return 'TEXT';
  }
}

function toSqlite(v: Value): string | number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

function fromSqlite(v: unknown, type: ColumnType): Value {
  if (v === null || v === undefined) return null;
  if (type === 'date') {
    if (v instanceof Date) return v;
    if (typeof v === 'string') {
      const d = new Date(v);
      return isNaN(d.getTime()) ? v : d;
    }
    return null;
  }
  if (type === 'boolean') {
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
    return Boolean(v);
  }
  if (type === 'number') {
    if (typeof v === 'number') return v;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }
  return typeof v === 'string' ? v : String(v);
}

/** A relation name we can quote safely into a CREATE TABLE statement.
 *  We accept the same identifier shape derup uses elsewhere. */
function isValidIdent(s: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
}

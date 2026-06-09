// Pre-execution semantic validation for the SQL editor.
//
// derup is a teaching tool for systems-engineering students. SQLite is
// laxly typed and permissively executes queries that Postgres / MySQL /
// SQL Server would reject. We want students to learn the STANDARD's
// rules, not SQLite's quirks — so before handing the SQL to sql.js we
// run a battery of validators here. Each one returns a Spanish message
// explaining what's wrong AND why; null = OK.
//
// Validators:
//   - validateGroupBy        — SELECT columns must be in GROUP BY or
//                              inside an aggregate (no bare cols).
//   - validateAggregateInWhere — WHERE can't contain COUNT/SUM/AVG/etc.
//                                (those belong in HAVING, after the group).
//   - validateInArity        — `col IN (SELECT …)` and `(c1,c2) IN (…)`
//                              must match the subquery's column count.
//
// All operate on a single statement (no semicolons inside). The caller
// is sqlEngine.execute() which splits + runs each validator per stmt.

import type { Database } from 'sql.js';

const AGG_FNS = new Set(['count', 'sum', 'avg', 'min', 'max', 'group_concat', 'total']);

// ─────────────────────────────────────────────────────────────────────────
// Generic clause extraction. Given a statement, find a clause keyword at
// top level (depth 0, outside quoted strings) and return its body — the
// text up to the next major clause or end of statement.
// ─────────────────────────────────────────────────────────────────────────

const MAJOR_CLAUSES = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET',
  'UNION ALL', 'UNION', 'INTERSECT', 'EXCEPT', 'WINDOW',
];

interface Clause {
  body: string;
  start: number;  // index in the original stmt of the body's first char
  end: number;    // exclusive end
}

/** Find the first occurrence of `clauseName` at top-level (paren depth 0,
 *  not inside a quoted string) and return its body. */
function findClause(stmt: string, clauseName: string): Clause | null {
  const re = new RegExp(`\\b${clauseName.replace(/\s+/g, '\\s+')}\\b`, 'gi');
  let depth = 0;
  let inStr: '\'' | '"' | null = null;
  for (let i = 0; i < stmt.length; i++) {
    const c = stmt[i];
    if (inStr) {
      if (c === '\\' && i + 1 < stmt.length) { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '\'' || c === '"') { inStr = c; continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth--; continue; }
    if (depth !== 0) continue;
    re.lastIndex = i;
    const m = re.exec(stmt);
    if (m && m.index === i) {
      const bodyStart = i + m[0].length;
      const bodyEnd = findNextClauseStart(stmt, bodyStart, clauseName);
      return { body: stmt.slice(bodyStart, bodyEnd).trim(), start: bodyStart, end: bodyEnd };
    }
  }
  return null;
}

/** Walk forward from `from` and return the index where the next major
 *  clause starts at depth 0 (so the current clause's body ends there).
 *  `currentClause` is excluded from the candidates so we don't stop on
 *  ourselves. */
function findNextClauseStart(stmt: string, from: number, currentClause: string): number {
  let depth = 0;
  let inStr: '\'' | '"' | null = null;
  const lowerCur = currentClause.toUpperCase();
  for (let i = from; i < stmt.length; i++) {
    const c = stmt[i];
    if (inStr) {
      if (c === '\\' && i + 1 < stmt.length) { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '\'' || c === '"') { inStr = c; continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth--; continue; }
    if (depth !== 0) continue;
    for (const cl of MAJOR_CLAUSES) {
      if (cl.toUpperCase() === lowerCur) continue;
      const re = new RegExp(`^\\b${cl.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (re.test(stmt.slice(i))) return i;
    }
  }
  return stmt.length;
}

/** Split a text on top-level commas (respects parens + strings). */
function splitTopComma(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr: '\'' | '"' | null = null;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\' && i + 1 < text.length) { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '\'' || c === '"') { inStr = c; continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth--; continue; }
    if (c === ',' && depth === 0) {
      out.push(text.slice(last, i).trim());
      last = i + 1;
    }
  }
  out.push(text.slice(last).trim());
  return out.filter(s => s.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers — categorise a SELECT item by its shape.
// ─────────────────────────────────────────────────────────────────────────

/** Strip "AS alias" / " alias" from the tail of a SELECT item so we look
 *  at the actual expression. */
function stripAlias(item: string): string {
  // Match trailing "AS name" or " name" (single identifier) at depth 0.
  // Conservative: only strip when there's a clear identifier at the end.
  const m = item.match(/^(.+?)\s+(?:as\s+)?([a-zA-Z_]\w*)\s*$/i);
  if (!m) return item.trim();
  // If the head is itself just an identifier (e.g. "emp eid"), don't strip
  // — that would be ambiguous. Otherwise the alias goes.
  return m[1].trim();
}

/** Does this SELECT item contain an aggregate function call? */
function hasAggregate(item: string): boolean {
  const re = /\b(count|sum|avg|min|max|group_concat|total)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(item)) !== null) {
    if (AGG_FNS.has(m[1].toLowerCase())) return true;
  }
  return false;
}

/** Is the item a literal constant (number, string, NULL, TRUE/FALSE)? */
function isConstant(item: string): boolean {
  const t = item.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return true;
  if (/^['"][^'"]*['"]$/.test(t)) return true;
  if (/^(NULL|TRUE|FALSE)$/i.test(t)) return true;
  return false;
}

/** Return the canonical text of a column reference (qualified or not) if
 *  the item is a bare column reference, or null otherwise. */
function extractBareColumn(item: string): string | null {
  const t = item.trim();
  if (/^\*$/.test(t)) return '*';
  // table.col
  if (/^[a-zA-Z_]\w*\.[a-zA-Z_]\w*$/.test(t)) return t;
  // col
  if (/^[a-zA-Z_]\w*$/.test(t)) return t;
  return null;
}

/** Two column refs match if they refer to the same thing. Compares
 *  case-insensitively and allows the GROUP BY's "emp.eid" to match
 *  SELECT's "eid" (and vice versa) — that's what Postgres does. */
function colMatch(a: string, b: string): boolean {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return true;
  // If one is qualified and the other isn't, compare the tail.
  const at = al.includes('.') ? al.split('.').pop()! : al;
  const bt = bl.includes('.') ? bl.split('.').pop()! : bl;
  return at === bt;
}

// ─────────────────────────────────────────────────────────────────────────
// Validator 1: GROUP BY — every SELECT item must be either in GROUP BY,
//              inside an aggregate, or a constant.
// ─────────────────────────────────────────────────────────────────────────

export function validateGroupBy(stmt: string): string | null {
  const groupByCl = findClause(stmt, 'GROUP BY');
  if (!groupByCl) return null;
  const selectCl = findClause(stmt, 'SELECT');
  if (!selectCl) return null;

  const groupCols = splitTopComma(groupByCl.body)
    .map(c => extractBareColumn(c))
    .filter((c): c is string => c !== null);

  const items = splitTopComma(selectCl.body);
  for (const raw of items) {
    const item = stripAlias(raw);
    if (item === '*') {
      return (
        'GROUP BY: usar SELECT * con GROUP BY no tiene sentido. ' +
        'Tenés que listar explícitamente las columnas que querés en el resultado ' +
        '(las que están en GROUP BY) y/o las funciones agregadas.'
      );
    }
    if (isConstant(item)) continue;
    if (hasAggregate(item)) continue;
    const bare = extractBareColumn(item);
    if (!bare) continue; // expression we can't categorise — skip
    if (groupCols.some(g => colMatch(g, bare))) continue;

    return (
      `GROUP BY: la columna '${bare}' aparece en SELECT pero no está en GROUP BY ` +
      `ni dentro de una función agregada.\n` +
      `   Dentro de cada grupo, '${bare}' puede tener varios valores distintos — ` +
      `el motor no sabe cuál mostrar. Por eso Postgres / MySQL (modo estricto) / ` +
      `SQL Server lo rechazan.\n` +
      `   Soluciones: agregar '${bare}' a GROUP BY, envolverla en una función ` +
      `agregada (MIN, MAX, GROUP_CONCAT…), o quitarla del SELECT.`
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Validator 2: aggregate functions are not allowed in WHERE.
// ─────────────────────────────────────────────────────────────────────────

export function validateAggregateInWhere(stmt: string): string | null {
  const whereCl = findClause(stmt, 'WHERE');
  if (!whereCl) return null;
  // Walk through the body looking for aggregate function calls — but only
  // at depth 0 inside WHERE itself (subqueries can use aggregates freely).
  let depth = 0;
  let inStr: '\'' | '"' | null = null;
  const re = /\b(count|sum|avg|min|max|group_concat|total)\s*\(/gi;
  const body = whereCl.body;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (c === '\\' && i + 1 < body.length) { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '\'' || c === '"') { inStr = c; continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth--; continue; }
    if (depth !== 0) continue;
    re.lastIndex = i;
    const m = re.exec(body);
    if (m && m.index === i && AGG_FNS.has(m[1].toLowerCase())) {
      return (
        `WHERE: las funciones agregadas (${m[1].toUpperCase()}) no pueden ` +
        `aparecer en WHERE.\n` +
        `   WHERE se aplica a cada fila individualmente, ANTES de agruparlas ` +
        `con GROUP BY. Los agregados sólo tienen sentido sobre grupos.\n` +
        `   Si querés filtrar grupos (por ejemplo "departamentos con más de ` +
        `5 empleados"), usá HAVING después del GROUP BY:\n` +
        `      ... GROUP BY did HAVING ${m[1].toUpperCase()}(...) > 5`
      );
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Validator 3: arity of IN / NOT IN with a subquery.
//   col IN (SELECT a, b FROM …)        ← left side has 1, right side has 2
//   (c1, c2) IN (SELECT a FROM …)      ← left side has 2, right side has 1
// Both are errors in standard SQL. SQLite would silently coerce.
// ─────────────────────────────────────────────────────────────────────────

export function validateInArity(stmt: string, db: Database): string | null {
  // Find every "IN (" or "NOT IN (" at top level whose contents start
  // with SELECT. We can't easily walk subqueries recursively here, so we
  // limit to top-level IN expressions.
  const inRe = /\b(NOT\s+)?IN\s*\(/gi;
  let depth = 0;
  let inStr: '\'' | '"' | null = null;
  for (let i = 0; i < stmt.length; i++) {
    const c = stmt[i];
    if (inStr) {
      if (c === '\\' && i + 1 < stmt.length) { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '\'' || c === '"') { inStr = c; continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth--; continue; }
    if (depth !== 0) continue;
    inRe.lastIndex = i;
    const m = inRe.exec(stmt);
    if (!m || m.index !== i) continue;

    // Find the matching close paren of the IN list.
    const openParen = i + m[0].length - 1;
    const close = findMatchingCloseParen(stmt, openParen);
    if (close < 0) { i = stmt.length; break; }
    const inner = stmt.slice(openParen + 1, close).trim();

    // Only act when the inner is a SELECT — value lists like IN (1,2,3)
    // are validated by SQLite itself.
    if (!/^SELECT\b/i.test(inner)) {
      i = close;
      continue;
    }

    // Left-hand side of the IN: either an identifier / qualified column,
    // or a parenthesised tuple "(c1, c2, c3)". Scan backwards from before
    // the optional "NOT" matched.
    const lhsEnd = m.index;
    const lhs = stmt.slice(0, lhsEnd).replace(/\s+$/, '');
    const lhsArity = countLhsArity(lhs);
    if (lhsArity === null) { i = close; continue; }

    // Probe the subquery's column count by running it with LIMIT 0.
    let rhsArity = -1;
    try {
      const sets = db.exec(`SELECT * FROM (${inner}) LIMIT 0`);
      if (sets.length > 0) rhsArity = sets[0].columns.length;
    } catch {
      // Subquery itself has a problem — let the real exec surface it.
      i = close;
      continue;
    }
    if (rhsArity < 0) { i = close; continue; }

    if (lhsArity !== rhsArity) {
      return (
        `IN: la expresión a la izquierda tiene ${lhsArity} columna${lhsArity !== 1 ? 's' : ''} ` +
        `pero la subconsulta devuelve ${rhsArity}.\n` +
        `   "x IN (SELECT …)" exige que la subconsulta devuelva exactamente UNA columna ` +
        `del mismo tipo. Para comparar varias columnas a la vez se usa la forma de ` +
        `tupla: "(c1, c2) IN (SELECT a, b FROM …)" — y ahí la cantidad también tiene ` +
        `que coincidir.`
      );
    }

    i = close;
  }
  return null;
}

/** Count the arity of the left side of an IN expression — 1 for a bare
 *  column or expression, N for a tuple "(c1, c2, …, cN)". Returns null
 *  when we can't make sense of it (let real exec handle the syntax error). */
function countLhsArity(lhs: string): number | null {
  const trimmed = lhs.trim();
  if (!trimmed) return null;
  // Tuple: ends in ')' and the matching '(' is at depth 0 from the back.
  if (trimmed.endsWith(')')) {
    // Walk backward to find the matching open
    let depth = 0;
    for (let i = trimmed.length - 1; i >= 0; i--) {
      if (trimmed[i] === ')') depth++;
      else if (trimmed[i] === '(') {
        depth--;
        if (depth === 0) {
          const inside = trimmed.slice(i + 1, trimmed.length - 1);
          // Only count as a tuple if the parens were preceded by whitespace
          // or start of expression — otherwise it might be a function call.
          const before = trimmed.slice(0, i).trim();
          if (before === '' || /[\s=<>!]$/.test(before) || /(?:^|\b)(?:and|or|where|on|having)$/i.test(before)) {
            return splitTopComma(inside).length;
          }
          break;
        }
      }
    }
  }
  // Otherwise: single expression on the left.
  return 1;
}

/** Given the position of an opening '(' in stmt, return the index of the
 *  matching ')'. Respects nested parens and quoted strings. */
function findMatchingCloseParen(stmt: string, openPos: number): number {
  let depth = 1;
  let inStr: '\'' | '"' | null = null;
  for (let i = openPos + 1; i < stmt.length; i++) {
    const c = stmt[i];
    if (inStr) {
      if (c === '\\' && i + 1 < stmt.length) { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '\'' || c === '"') { inStr = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ─────────────────────────────────────────────────────────────────────────
// Public entry — run all validators against one statement and return the
// first error. Stop on first failure so the user only sees one issue at
// a time (less noise; fixing one often reveals/fixes others).
// ─────────────────────────────────────────────────────────────────────────

export function validateStatement(stmt: string, db: Database): string | null {
  return (
    validateGroupBy(stmt) ??
    validateAggregateInWhere(stmt) ??
    validateInArity(stmt, db) ??
    null
  );
}

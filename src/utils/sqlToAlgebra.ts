// SQL → relational-algebra translator (subset).
//
// Covers the common SELECT statement shapes:
//   SELECT * FROM r                             → r
//   SELECT c1,c2 FROM r                         → π c1,c2 (r)
//   SELECT * FROM r WHERE cond                  → σ cond (r)
//   SELECT c1 FROM r WHERE cond                 → π c1 (σ cond (r))
//   SELECT * FROM r, s                          → r ⨯ s
//   SELECT * FROM r CROSS JOIN s                → r ⨯ s
//   SELECT * FROM r NATURAL JOIN s              → r ⋈ s
//   SELECT * FROM r JOIN s ON r.x = s.x         → r ⋈_{r.x = s.x} s
//   SELECT * FROM r INNER JOIN s ON ...         → same as JOIN
//   SELECT * FROM r, s WHERE r.x = s.x          → σ r.x=s.x (r ⨯ s)
//
// Out of scope (returns null so the algebra parser surfaces its native error):
//   - GROUP BY / HAVING / ORDER BY / LIMIT — no equivalent in classical algebra
//   - subqueries / UNION / nested CTEs
//   - aggregate functions (COUNT, SUM, etc.)
//   - OUTER JOIN / LEFT JOIN / RIGHT JOIN

export interface SqlTranslationResult {
  algebra: string;
  /** Short note shown to the user explaining what was translated. */
  note: string;
}

export function sqlToAlgebra(input: string): SqlTranslationResult | null {
  const cleaned = input.trim().replace(/;+\s*$/, '');
  if (!/^\s*select\s+/i.test(cleaned)) return null;

  // 1) Tokenise into clauses. We do this manually because regex captures
  //    don't compose well with optional pieces (WHERE, JOIN ON, etc.).
  // Strip the leading SELECT.
  const afterSelect = cleaned.replace(/^\s*select\s+/i, '');

  // Find the matching FROM at top-level (no parens).
  const fromIdx = findKeyword(afterSelect, /\bfrom\b/i);
  if (fromIdx < 0) return null;
  const cols = afterSelect.slice(0, fromIdx).trim();
  let rest = afterSelect.slice(fromIdx).replace(/^\s*from\s+/i, '');

  // Optional WHERE
  let where: string | null = null;
  const whereIdx = findKeyword(rest, /\bwhere\b/i);
  if (whereIdx >= 0) {
    where = rest.slice(whereIdx).replace(/^\s*where\s+/i, '').trim();
    rest = rest.slice(0, whereIdx).trim();
  }

  // Unsupported tail clauses → bail so the native parser gives its error.
  if (/\b(group\s+by|having|order\s+by|limit|union|intersect|except)\b/i.test(rest)) return null;
  if (where && /\b(group\s+by|having|order\s+by|limit|union|intersect|except)\b/i.test(where)) return null;

  // 2) Build the FROM expression
  const fromExpr = parseFromClause(rest.trim());
  if (!fromExpr) return null;

  // 3) Apply WHERE as σ
  let expr = fromExpr;
  if (where) {
    expr = `σ ${normalizeCondition(where)} (${expr})`;
  }

  // 4) Apply column list as π if not *
  if (cols !== '*') {
    // Validate each column is a simple identifier (optionally qualified
    // with a table name). Aggregates like COUNT(*), SUM(x), AVG(x) have
    // no equivalent in classical relational algebra and would produce
    // invalid syntax if we projected them naïvely.
    const colParts = splitTopLevel(cols, ',').map(c => c.trim()).filter(Boolean);
    if (colParts.length === 0) return null;
    const COL_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?$/;
    for (const c of colParts) {
      if (!COL_RE.test(c)) return null; // aggregates, expressions, * inside fn, etc.
    }
    expr = `π ${colParts.join(', ')} (${expr})`;
  }

  return {
    algebra: expr,
    note: `Traduje SQL → álgebra: ${expr}`,
  };
}

/** Find the byte offset of the first occurrence of `re` at paren depth 0.
 *  Returns -1 if not found. */
function findKeyword(text: string, re: RegExp): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (depth === 0) {
      const m = text.slice(i).match(re);
      // Only accept the match when it starts AT i (regex without anchor still
      // matches at any offset; we want "at i").
      if (m && m.index === 0) return i;
    }
  }
  return -1;
}

/** Translate the FROM clause into an algebra expression. */
function parseFromClause(text: string): string | null {
  if (!text) return null;

  // Split on top-level commas → cross product of the parts.
  const commaParts = splitTopLevel(text, ',');
  if (commaParts.length > 1) {
    const translated = commaParts.map(p => parseFromClause(p.trim()));
    if (translated.some(t => t === null)) return null;
    return translated.join(' ⨯ ');
  }

  // Check for JOIN keywords at top level.
  // Patterns we support:
  //   <left> NATURAL JOIN <right>
  //   <left> CROSS JOIN <right>
  //   <left> [INNER] JOIN <right> ON <cond>
  const joinMatch = matchJoin(text);
  if (joinMatch) {
    const left = parseFromClause(joinMatch.left.trim());
    const right = parseFromClause(joinMatch.right.trim());
    if (!left || !right) return null;
    if (joinMatch.kind === 'natural') return `${left} ⋈ ${right}`;
    if (joinMatch.kind === 'cross')   return `${left} ⨯ ${right}`;
    if (joinMatch.kind === 'inner' && joinMatch.on) {
      return `${left} ⋈_{${normalizeCondition(joinMatch.on)}} ${right}`;
    }
    return null;
  }

  // Single identifier (possibly with alias which we ignore for the algebra).
  const ident = text.trim().split(/\s+/)[0];
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) return ident;
  // Parenthesised subexpression
  if (text.startsWith('(') && text.endsWith(')')) {
    const inner = text.slice(1, -1).trim();
    const sub = parseFromClause(inner);
    return sub ? `(${sub})` : null;
  }
  return null;
}

interface JoinMatch {
  kind: 'natural' | 'cross' | 'inner';
  left: string;
  right: string;
  on?: string;
}

/** Look for a JOIN keyword at top-level of `text`. Returns the split if found. */
function matchJoin(text: string): JoinMatch | null {
  // Natural join
  const naturalIdx = findKeywordPhrase(text, /\bnatural\s+join\b/i);
  if (naturalIdx >= 0) {
    const left = text.slice(0, naturalIdx).trim();
    const right = text.slice(naturalIdx).replace(/^\s*natural\s+join\s+/i, '').trim();
    return { kind: 'natural', left, right };
  }
  // Cross join
  const crossIdx = findKeywordPhrase(text, /\bcross\s+join\b/i);
  if (crossIdx >= 0) {
    const left = text.slice(0, crossIdx).trim();
    const right = text.slice(crossIdx).replace(/^\s*cross\s+join\s+/i, '').trim();
    return { kind: 'cross', left, right };
  }
  // INNER JOIN / JOIN with ON
  const joinIdx = findKeywordPhrase(text, /\b(?:inner\s+)?join\b/i);
  if (joinIdx >= 0) {
    const left = text.slice(0, joinIdx).trim();
    const tail = text.slice(joinIdx).replace(/^\s*(?:inner\s+)?join\s+/i, '');
    const onIdx = findKeyword(tail, /\bon\b/i);
    if (onIdx < 0) return null;
    const right = tail.slice(0, onIdx).trim();
    const on = tail.slice(onIdx).replace(/^\s*on\s+/i, '').trim();
    return { kind: 'inner', left, right, on };
  }
  return null;
}

function findKeywordPhrase(text: string, re: RegExp): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (depth === 0) {
      const m = text.slice(i).match(re);
      if (m && m.index === 0) return i;
    }
  }
  return -1;
}

/** Split `text` on the given top-level character (depth-0 only). */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === sep && depth === 0) {
      out.push(text.slice(last, i));
      last = i + 1;
    }
  }
  out.push(text.slice(last));
  return out;
}

/** Adjust SQL condition syntax to algebra-friendly. */
function normalizeCondition(cond: string): string {
  return cond
    .replace(/<>/g, '≠')
    .replace(/!=/g, '≠')
    .replace(/\band\b/gi, '∧')
    .replace(/\bor\b/gi, '∨')
    .replace(/\bnot\b/gi, '¬')
    .replace(/\bis\s+null\b/gi, '= null')
    .replace(/\bis\s+not\s+null\b/gi, '≠ null')
    .trim();
}

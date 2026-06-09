// Context-aware SQL autocomplete for the SQL tab.
//
// Strategy is the same one VS Code and DataGrip use for ad-hoc completion:
// don't parse the whole grammar — find the most recent "anchor" keyword
// before the caret (SELECT / FROM / WHERE / JOIN / GROUP BY / …) at
// paren-depth zero, and let that anchor pick which suggestion bucket to show.
//
// Buckets:
//   AFTER_SELECT        → columns · '*' · DISTINCT · aggregate funcs
//   AFTER_FROM          → tables · '('
//   AFTER_JOIN          → tables
//   AFTER_ON            → qualified columns + comparison operators
//   AFTER_WHERE         → columns · NOT · EXISTS · aggregate funcs · operators
//   AFTER_HAVING        → aggregate funcs · columns · operators
//   AFTER_GROUP_BY      → columns
//   AFTER_ORDER_BY      → columns · ASC · DESC
//   AFTER_INSERT_INTO   → tables
//   AFTER_UPDATE        → tables
//   AFTER_SET           → columns (for `col = …`)
//   AFTER_DELETE_FROM   → tables
//   START               → SELECT · INSERT · UPDATE · DELETE · WITH · CREATE …
//
// The state of the parser tracks both the anchor AND whether we are right
// after a comma / a column / a comparison operator, so we can suggest the
// right thing inside a SELECT list, ON clause, etc.

import type { Suggestion } from './algebraPredict';
export { wordAtCaret } from './algebraPredict';

export interface SqlSchema {
  tables: string[];
  /** Column names per table (preserves declaration order). */
  columnsByTable: Map<string, string[]>;
  /** Distinct union of column names across all tables. */
  allColumns: string[];
}

// ── SQL keyword sets ───────────────────────────────────────────────────────

/** SQL reserved words we recognise. Used to tell "user typed a column" apart
 *  from "user just typed a keyword" when picking suggestions. */
const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'HAVING', 'GROUP', 'ORDER', 'BY',
  'JOIN', 'INNER', 'OUTER', 'LEFT', 'RIGHT', 'CROSS', 'NATURAL', 'FULL', 'ON', 'USING',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'TABLE', 'INDEX', 'VIEW',
  'AS', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS', 'NULL',
  'DISTINCT', 'ALL', 'UNION', 'INTERSECT', 'EXCEPT', 'WITH', 'RECURSIVE',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'ASC', 'DESC', 'LIMIT', 'OFFSET',
  'TRUE', 'FALSE', 'CAST',
]);

const KW_AGG = ['count', 'sum', 'avg', 'min', 'max', 'group_concat', 'total'];
const KW_FN_STR = ['lower', 'upper', 'length', 'substr', 'trim', 'replace', 'instr', 'coalesce', 'ifnull'];
// Reserved for future use — date/math built-ins will land in the suggestion
// list when we have a way to scope them (e.g. after `WHERE col >` we know
// the next thing is likely a date function rather than a column ref).
// const KW_FN_DATE = ['date', 'datetime', 'time', 'strftime', "date('now')"];
// const KW_FN_MATH = ['abs', 'round', 'min', 'max', 'random', 'cast'];

const KW_START = [
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER',
  'WITH', 'BEGIN', 'COMMIT', 'ROLLBACK', 'EXPLAIN',
];

const KW_AFTER_SELECT = ['DISTINCT', 'ALL', 'FROM'];
const KW_AFTER_FROM_OR_REL = ['WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'CROSS JOIN', 'NATURAL JOIN', 'UNION', 'INTERSECT', 'EXCEPT'];
const KW_AFTER_WHERE = ['AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS NULL', 'IS NOT NULL', 'EXISTS', 'ORDER BY', 'GROUP BY', 'LIMIT'];
const KW_AFTER_ORDER = ['ASC', 'DESC'];
const KW_AFTER_INSERT = ['INTO'];
const KW_DML_TAIL = ['VALUES', 'SELECT'];

// ── Tokenization (very small subset — just enough to find anchors) ────────

interface SqlToken {
  text: string;
  upper: string;
  start: number;
  end: number;
  kind: 'ident' | 'string' | 'number' | 'punct' | 'space' | 'comment';
}

function tokenize(input: string): SqlToken[] {
  const out: SqlToken[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    // line comment
    if (c === '-' && input[i + 1] === '-') {
      const start = i;
      while (i < input.length && input[i] !== '\n') i++;
      out.push({ text: input.slice(start, i), upper: '', start, end: i, kind: 'comment' });
      continue;
    }
    // whitespace
    if (/\s/.test(c)) {
      const start = i;
      while (i < input.length && /\s/.test(input[i])) i++;
      out.push({ text: input.slice(start, i), upper: '', start, end: i, kind: 'space' });
      continue;
    }
    // string
    if (c === "'" || c === '"') {
      const quote = c;
      const start = i;
      i++;
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) i++;
        i++;
      }
      if (i < input.length) i++;
      out.push({ text: input.slice(start, i), upper: '', start, end: i, kind: 'string' });
      continue;
    }
    // number
    if (/[0-9]/.test(c)) {
      const start = i;
      while (i < input.length && /[0-9.]/.test(input[i])) i++;
      out.push({ text: input.slice(start, i), upper: '', start, end: i, kind: 'number' });
      continue;
    }
    // identifier / keyword
    if (/[a-zA-Z_]/.test(c)) {
      const start = i;
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) i++;
      const text = input.slice(start, i);
      out.push({ text, upper: text.toUpperCase(), start, end: i, kind: 'ident' });
      continue;
    }
    // punctuation — single char
    out.push({ text: c, upper: c, start: i, end: i + 1, kind: 'punct' });
    i++;
  }
  return out;
}

// ── Anchor / context detection ────────────────────────────────────────────

type Anchor =
  | 'START'
  | 'AFTER_SELECT'
  | 'AFTER_FROM'
  | 'AFTER_JOIN'
  | 'AFTER_ON'
  | 'AFTER_WHERE'
  | 'AFTER_HAVING'
  | 'AFTER_GROUP_BY'
  | 'AFTER_ORDER_BY'
  | 'AFTER_INSERT'
  | 'AFTER_INSERT_INTO'
  | 'AFTER_UPDATE'
  | 'AFTER_SET'
  | 'AFTER_DELETE'
  | 'AFTER_DELETE_FROM'
  | 'AFTER_VALUES'
  | 'AFTER_BY_PARTIAL';

interface AnchorState {
  anchor: Anchor;
  /** Token right before the caret (last meaningful token, ignoring whitespace
   *  and comments). Useful to know if we just typed a column / a comma / a
   *  comparison operator. */
  prev?: SqlToken;
  /** Whether we're inside a balanced subquery (depth > 0 means the FROM in
   *  an outer query won't override what's happening here). */
  inSubquery: boolean;
}

function detectAnchor(tokens: SqlToken[]): AnchorState {
  // Walk forward, tracking paren depth + the last anchor at depth 0.
  let depth = 0;
  let anchor: Anchor = 'START';
  // Stack to restore the outer anchor when a subquery closes
  const stack: Anchor[] = [];
  let prev: SqlToken | undefined;
  let i = 0;
  let prevAnchor: Anchor = 'START';

  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === 'space' || t.kind === 'comment') { i++; continue; }

    if (t.kind === 'punct') {
      if (t.text === '(') {
        depth++;
        stack.push(anchor);
        // entering a subquery wipes the local anchor
        anchor = 'START';
        prevAnchor = 'START';
      } else if (t.text === ')') {
        if (depth > 0) {
          depth--;
          anchor = stack.pop() ?? 'START';
        }
      }
      prev = t;
      i++;
      continue;
    }

    if (t.kind === 'ident') {
      const U = t.upper;
      // Two-word anchors: GROUP BY, ORDER BY, INSERT INTO, DELETE FROM,
      // LEFT/RIGHT/INNER/CROSS/NATURAL/FULL JOIN.
      if (U === 'GROUP' && nextNonSpace(tokens, i + 1)?.upper === 'BY') {
        anchor = 'AFTER_GROUP_BY'; prevAnchor = anchor;
        const n = nextNonSpaceIdx(tokens, i + 1);
        prev = tokens[n];
        i = n + 1;
        continue;
      }
      if (U === 'ORDER' && nextNonSpace(tokens, i + 1)?.upper === 'BY') {
        anchor = 'AFTER_ORDER_BY'; prevAnchor = anchor;
        const n = nextNonSpaceIdx(tokens, i + 1);
        prev = tokens[n];
        i = n + 1;
        continue;
      }
      if (U === 'INSERT') {
        anchor = 'AFTER_INSERT'; prevAnchor = anchor;
        prev = t; i++; continue;
      }
      if (anchor === 'AFTER_INSERT' && U === 'INTO') {
        anchor = 'AFTER_INSERT_INTO'; prevAnchor = anchor;
        prev = t; i++; continue;
      }
      if (U === 'DELETE') {
        anchor = 'AFTER_DELETE'; prevAnchor = anchor;
        prev = t; i++; continue;
      }
      if (anchor === 'AFTER_DELETE' && U === 'FROM') {
        anchor = 'AFTER_DELETE_FROM'; prevAnchor = anchor;
        prev = t; i++; continue;
      }
      // Single-word anchors
      if (U === 'SELECT') { anchor = 'AFTER_SELECT'; prevAnchor = anchor; prev = t; i++; continue; }
      if (U === 'FROM') { anchor = 'AFTER_FROM'; prevAnchor = anchor; prev = t; i++; continue; }
      if (U === 'JOIN') { anchor = 'AFTER_JOIN'; prevAnchor = anchor; prev = t; i++; continue; }
      if (U === 'ON') { anchor = 'AFTER_ON'; prevAnchor = anchor; prev = t; i++; continue; }
      if (U === 'WHERE') { anchor = 'AFTER_WHERE'; prevAnchor = anchor; prev = t; i++; continue; }
      if (U === 'HAVING') { anchor = 'AFTER_HAVING'; prevAnchor = anchor; prev = t; i++; continue; }
      if (U === 'UPDATE') { anchor = 'AFTER_UPDATE'; prevAnchor = anchor; prev = t; i++; continue; }
      if (U === 'SET' && (prevAnchor === 'AFTER_UPDATE' || prevAnchor === 'AFTER_SET')) {
        anchor = 'AFTER_SET'; prevAnchor = anchor; prev = t; i++; continue;
      }
      if (U === 'VALUES') { anchor = 'AFTER_VALUES'; prevAnchor = anchor; prev = t; i++; continue; }
      // non-anchor identifier
      prev = t;
      i++;
      continue;
    }

    // string / number → not anchors
    prev = t;
    i++;
  }
  return { anchor, prev, inSubquery: depth > 0 };
}

function nextNonSpace(tokens: SqlToken[], from: number): SqlToken | undefined {
  for (let i = from; i < tokens.length; i++) {
    if (tokens[i].kind !== 'space' && tokens[i].kind !== 'comment') return tokens[i];
  }
  return undefined;
}
function nextNonSpaceIdx(tokens: SqlToken[], from: number): number {
  for (let i = from; i < tokens.length; i++) {
    if (tokens[i].kind !== 'space' && tokens[i].kind !== 'comment') return i;
  }
  return tokens.length - 1;
}

// ── Suggestion builders ───────────────────────────────────────────────────

function kw(text: string, hint?: string): Suggestion {
  return { text, label: text, hint, kind: 'keyword', pad: 'name' };
}
function tbl(text: string): Suggestion {
  return { text, label: text, hint: 'tabla', kind: 'relation', pad: 'name' };
}
function col(text: string, hint?: string): Suggestion {
  return { text, label: text, hint, kind: 'column', pad: 'name' };
}
function fn(text: string, hint?: string): Suggestion {
  return { text: `${text}(`, label: `${text}()`, hint, kind: 'operator', pad: 'none' };
}

function selectSuggestions(schema: SqlSchema, prevWasComma: boolean): Suggestion[] {
  const out: Suggestion[] = [];
  if (!prevWasComma) {
    out.push(kw('*', 'todas las columnas'));
    out.push(kw('DISTINCT', 'sin duplicados'));
  }
  for (const c of schema.allColumns) out.push(col(c));
  for (const f of KW_AGG) out.push(fn(f.toUpperCase(), 'función agregada'));
  for (const f of KW_FN_STR) out.push(fn(f.toUpperCase(), 'función de string'));
  if (!prevWasComma) {
    out.push(kw('FROM', 'tabla origen'));
  }
  return out;
}

function fromSuggestions(schema: SqlSchema): Suggestion[] {
  const out: Suggestion[] = [];
  for (const t of schema.tables) out.push(tbl(t));
  return out;
}

function afterTableSuggestions(): Suggestion[] {
  return KW_AFTER_FROM_OR_REL.map(k => kw(k));
}

function whereSuggestions(schema: SqlSchema): Suggestion[] {
  const out: Suggestion[] = [];
  for (const c of schema.allColumns) out.push(col(c));
  for (const k of KW_AFTER_WHERE) out.push(kw(k));
  for (const f of KW_AGG) out.push(fn(f.toUpperCase()));
  return out;
}

function orderSuggestions(schema: SqlSchema): Suggestion[] {
  const out: Suggestion[] = [];
  for (const c of schema.allColumns) out.push(col(c));
  for (const k of KW_AFTER_ORDER) out.push(kw(k));
  return out;
}

function startSuggestions(): Suggestion[] {
  return KW_START.map(k => kw(k));
}

// ── Main entry ────────────────────────────────────────────────────────────

const COMPARISON_OPS = new Set(['=', '<', '>', '!=', '<=', '>=']);

export function predictSql(query: string, caretPos: number, schema: SqlSchema): Suggestion[] {
  const prefix = query.slice(0, caretPos);
  // Trim the partial word being typed so it doesn't show up as an anchor.
  const tokens = tokenize(prefix);
  // Drop trailing ident — it's the word the user is typing, used only for
  // filtering, not for anchor detection. (Otherwise typing "SE" looks like
  // an anchor of its own.)
  let scanTokens = tokens;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.kind === 'space' || t.kind === 'comment') continue;
    if (t.kind === 'ident' && t.end === caretPos) {
      scanTokens = tokens.slice(0, i);
    }
    break;
  }

  const { anchor, prev } = detectAnchor(scanTokens);
  const word = wordAtCaretLocal(query, caretPos).word;

  // Helper: did the previous meaningful token end with a comparison or ',' ?
  const prevIsComma = prev?.text === ',';
  const prevIsCmpOp = !!prev && COMPARISON_OPS.has(prev.text);
  /** True when prev is an identifier the user typed (NOT a SQL reserved word).
   *  Distinguishes "user just typed a column name" from "user just typed a
   *  keyword like ON, FROM, WHERE" — they imply different next suggestions. */
  const prevIsUserIdent = !!prev && prev.kind === 'ident' && !SQL_KEYWORDS.has(prev.upper);

  let suggestions: Suggestion[] = [];

  switch (anchor) {
    case 'START':
      suggestions = startSuggestions();
      break;
    case 'AFTER_SELECT':
      // If user just typed an aggregate function name or DISTINCT, suggest cols.
      // If just typed a column, suggest ',' / FROM via KW_AFTER_SELECT.
      if (prevIsUserIdent) {
        // Just typed an identifier (column) → suggest comma/FROM
        suggestions = [kw('FROM'), kw(','), ...KW_AFTER_SELECT.map(k => kw(k)), ...schema.allColumns.map(c => col(c))];
      } else {
        suggestions = selectSuggestions(schema, prevIsComma);
      }
      break;
    case 'AFTER_FROM':
    case 'AFTER_JOIN':
      if (prevIsUserIdent) {
        // Already named a table → suggest joins / WHERE / etc.
        suggestions = afterTableSuggestions();
      } else {
        suggestions = fromSuggestions(schema);
      }
      break;
    case 'AFTER_ON':
      // ON col = col — columns first, then '=' and AND
      if (prevIsCmpOp) {
        suggestions = schema.allColumns.map(c => col(c));
      } else if (prevIsUserIdent) {
        suggestions = [kw('='), kw('AND'), kw('OR'), ...schema.allColumns.map(c => col(c))];
      } else {
        suggestions = schema.allColumns.map(c => col(c));
      }
      break;
    case 'AFTER_WHERE':
    case 'AFTER_HAVING':
      if (prevIsCmpOp) {
        suggestions = schema.allColumns.map(c => col(c));
      } else if (prevIsUserIdent) {
        // typed a column → operator suggestions
        suggestions = ['=', '<>', '<', '>', '<=', '>=', 'LIKE', 'IN', 'BETWEEN', 'IS NULL', 'IS NOT NULL', 'AND', 'OR'].map(k => kw(k));
      } else {
        suggestions = whereSuggestions(schema);
      }
      break;
    case 'AFTER_GROUP_BY':
      if (prevIsUserIdent) {
        suggestions = [kw(','), kw('HAVING'), kw('ORDER BY'), kw('LIMIT'), ...schema.allColumns.map(c => col(c))];
      } else {
        suggestions = schema.allColumns.map(c => col(c));
      }
      break;
    case 'AFTER_ORDER_BY':
      if (prevIsUserIdent) {
        suggestions = [kw('ASC'), kw('DESC'), kw(','), kw('LIMIT'), ...schema.allColumns.map(c => col(c))];
      } else {
        suggestions = orderSuggestions(schema);
      }
      break;
    case 'AFTER_INSERT':
      suggestions = [kw('INTO'), ...KW_AFTER_INSERT.map(k => kw(k))];
      break;
    case 'AFTER_INSERT_INTO':
      if (prevIsUserIdent) {
        suggestions = [kw('VALUES'), kw('SELECT'), kw('('), ...KW_DML_TAIL.map(k => kw(k))];
      } else {
        suggestions = fromSuggestions(schema);
      }
      break;
    case 'AFTER_UPDATE':
      if (prevIsUserIdent) {
        suggestions = [kw('SET')];
      } else {
        suggestions = fromSuggestions(schema);
      }
      break;
    case 'AFTER_SET':
      if (prevIsCmpOp) {
        // value
        suggestions = schema.allColumns.map(c => col(c));
      } else if (prevIsUserIdent) {
        suggestions = [kw('='), kw(','), kw('WHERE')];
      } else {
        suggestions = schema.allColumns.map(c => col(c));
      }
      break;
    case 'AFTER_DELETE':
      suggestions = [kw('FROM')];
      break;
    case 'AFTER_DELETE_FROM':
      if (prevIsUserIdent) {
        suggestions = [kw('WHERE')];
      } else {
        suggestions = fromSuggestions(schema);
      }
      break;
    case 'AFTER_VALUES':
      suggestions = [kw('(')];
      break;
    default:
      suggestions = startSuggestions();
  }

  // Filter by what the user is currently typing (case-insensitive prefix).
  if (word) {
    const w = word.toLowerCase();
    suggestions = suggestions.filter(s => s.label.toLowerCase().startsWith(w));
  }

  // Dedup by label
  const seen = new Set<string>();
  const ranked: Suggestion[] = [];
  for (const s of suggestions) {
    if (seen.has(s.label.toLowerCase())) continue;
    seen.add(s.label.toLowerCase());
    ranked.push(s);
  }
  return ranked.slice(0, 14);
}

function wordAtCaretLocal(query: string, caretPos: number): { word: string; start: number } {
  let i = caretPos;
  while (i > 0 && /[a-zA-Z0-9_.*]/.test(query[i - 1])) i--;
  return { word: query.slice(i, caretPos), start: i };
}

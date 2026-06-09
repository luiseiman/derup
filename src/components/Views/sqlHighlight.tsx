// Lightweight SQL syntax highlighter for the SQL editor.
//
// Same architecture as algebraHighlight.tsx: single pass over the raw text,
// emits styled <span>s. Robust to incomplete input — never throws.
//
// Classes mirror the algebra editor's so we reuse the same CSS palette:
//   tk-op-bin     → SQL keywords (SELECT, FROM, WHERE, JOIN, …)
//   tk-op-log     → aggregate / logical / built-in functions (COUNT, AND, …)
//   tk-rel        → relation names that exist in the loaded schema
//   tk-col        → column names that exist in the loaded schema
//   tk-val-str    → string literals
//   tk-val-num    → number literals
//   tk-val        → boolean literals (TRUE/FALSE) and NULL
//   tk-cmp        → comparison operators
//   tk-punct      → '(' ')' ',' ';' '.' '*'
//   tk-comment    → '-- to end of line' and '/* … */'
//   tk-ident      → fallback (unknown identifier)

import React from 'react';

export interface SqlHighlightSchema {
  tables: string[];
  columns: string[];
}

// Keyword sets are case-insensitive — we lowercase before lookup.
const KEYWORDS = new Set([
  'select', 'from', 'where', 'having', 'group', 'order', 'by',
  'join', 'inner', 'outer', 'left', 'right', 'cross', 'natural', 'full', 'on', 'using',
  'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'drop', 'alter',
  'table', 'index', 'view', 'database', 'schema', 'as', 'distinct', 'all',
  'union', 'intersect', 'except', 'with', 'recursive',
  'case', 'when', 'then', 'else', 'end',
  'asc', 'desc', 'limit', 'offset',
  'primary', 'key', 'foreign', 'references', 'unique', 'check', 'default',
  'begin', 'commit', 'rollback', 'transaction', 'savepoint',
  'if', 'exists',
]);

const LOGICAL = new Set(['and', 'or', 'not', 'in', 'between', 'like', 'is', 'exists']);
const VALUE_LIT = new Set(['true', 'false', 'null']);
const BUILTIN_FN = new Set([
  'count', 'sum', 'avg', 'min', 'max', 'group_concat', 'total',
  'abs', 'round', 'random', 'cast',
  'lower', 'upper', 'length', 'substr', 'trim', 'replace', 'instr',
  'coalesce', 'ifnull', 'nullif',
  'date', 'datetime', 'time', 'strftime', 'julianday',
]);

export function highlightSql(query: string, schema: SqlHighlightSchema): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  let prevNonWs = '';

  const push = (text: string, cls: string) => {
    out.push(
      cls
        ? <span key={key++} className={cls}>{text}</span>
        : <React.Fragment key={key++}>{text}</React.Fragment>
    );
    for (let j = text.length - 1; j >= 0; j--) {
      if (!/\s/.test(text[j])) { prevNonWs = text[j]; break; }
    }
  };

  const tables = new Set(schema.tables);
  const columns = new Set(schema.columns);

  while (i < query.length) {
    const c = query[i];

    // Line comment "-- … \n"
    if (c === '-' && query[i + 1] === '-') {
      const nl = query.indexOf('\n', i);
      const stop = nl < 0 ? query.length : nl;
      push(query.slice(i, stop), 'tk-comment');
      i = stop;
      continue;
    }
    // Block comment "/* … */"
    if (c === '/' && query[i + 1] === '*') {
      const end = query.indexOf('*/', i + 2);
      const stop = end < 0 ? query.length : end + 2;
      push(query.slice(i, stop), 'tk-comment');
      i = stop;
      continue;
    }

    // Whitespace
    if (/\s/.test(c)) {
      let j = i;
      while (j < query.length && /\s/.test(query[j])) j++;
      out.push(<React.Fragment key={key++}>{query.slice(i, j)}</React.Fragment>);
      i = j;
      continue;
    }

    // String literal — single or double quoted (double-quoted is a SQLite
    // identifier-quote but we still colour it like a string).
    if (c === '\'' || c === '"') {
      const quote = c;
      let j = i + 1;
      while (j < query.length && query[j] !== quote) {
        if (query[j] === '\\' && j + 1 < query.length) j++;
        j++;
      }
      if (j < query.length) j++;
      push(query.slice(i, j), 'tk-val-str');
      i = j;
      continue;
    }

    // Number literal
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < query.length && /[0-9]/.test(query[j])) j++;
      if (query[j] === '.' && /[0-9]/.test(query[j + 1])) {
        j++;
        while (j < query.length && /[0-9]/.test(query[j])) j++;
      }
      push(query.slice(i, j), 'tk-val-num');
      i = j;
      continue;
    }

    // Multi-char operators
    if (c === '<' && (query[i + 1] === '=' || query[i + 1] === '>')) { push(query.slice(i, i + 2), 'tk-cmp'); i += 2; continue; }
    if (c === '>' && query[i + 1] === '=') { push('>=', 'tk-cmp'); i += 2; continue; }
    if (c === '!' && query[i + 1] === '=') { push('!=', 'tk-cmp'); i += 2; continue; }
    if (c === '|' && query[i + 1] === '|') { push('||', 'tk-op-bin'); i += 2; continue; }

    // Comparison single chars
    if (c === '=' || c === '<' || c === '>') { push(c, 'tk-cmp'); i++; continue; }

    // Punctuation
    if ('(),;.'.includes(c)) { push(c, 'tk-punct'); i++; continue; }
    if (c === '*') { push(c, 'tk-punct'); i++; continue; }

    // Identifier / keyword
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < query.length && /[a-zA-Z0-9_]/.test(query[j])) j++;
      const text = query.slice(i, j);
      const lower = text.toLowerCase();
      let cls: string;
      if (KEYWORDS.has(lower)) cls = 'tk-op-bin';
      else if (LOGICAL.has(lower)) cls = 'tk-op-log';
      else if (BUILTIN_FN.has(lower)) cls = 'tk-op-log';
      else if (VALUE_LIT.has(lower)) cls = 'tk-val';
      else if (tables.has(text)) cls = 'tk-rel';
      else if (columns.has(text)) cls = 'tk-col';
      else if (prevNonWs === '.') cls = 'tk-col'; // qualified col after '.'
      else cls = 'tk-ident';
      push(text, cls);
      i = j;
      continue;
    }

    // Anything else — pass through uncoloured
    push(c, '');
    i++;
  }

  // Trailing newline placeholder so the overlay stays aligned with the textarea
  // when the user just pressed Enter.
  out.push(<React.Fragment key={key++}>{'\n'}</React.Fragment>);
  return out;
}

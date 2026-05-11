// Lightweight syntax highlighter for the relational-algebra editor.
// Walks the raw text once and emits styled <span>s — robust to incomplete
// input (no parsing, no thrown errors).

import React from 'react';

export interface HighlightSchema {
  relations: string[];   // known relation names (schema tables + imported)
  columns: string[];     // distinct column names across all known relations
}

const KW_OP_UNARY = new Set(['select', 'project', 'rename', 'aggregate', 'group', 'gamma', 'agrupar']);
const KW_OP_BIN   = new Set(['join', 'cross', 'union', 'intersect', 'difference', 'division']);
const KW_LOG      = new Set(['and', 'or', 'not']);
const KW_BOOL     = new Set(['true', 'false']);
/** Aggregate function names — highlighted distinctly so γ_{count(*)} reads well. */
const KW_AGG_FN   = new Set(['count', 'sum', 'avg', 'min', 'max']);

const UNICODE_UNARY = 'σπργΓ';
const UNICODE_BIN   = '⋈⨯÷∪∩−⨝';
const UNICODE_LOG   = '∧∨¬';
const UNICODE_CMP   = '≠≤≥';
const UNICODE_ARROW = '→';

function classify(text: string, prevNonWs: string, schema: HighlightSchema): string {
  const lower = text.toLowerCase();
  const base = lower.endsWith('_') ? lower.slice(0, -1) : lower;
  if (KW_OP_UNARY.has(base)) return 'tk-op-unary';
  if (KW_OP_BIN.has(base))   return 'tk-op-bin';
  if (KW_LOG.has(base))      return 'tk-op-log';
  if (KW_BOOL.has(lower))    return 'tk-val';
  if (KW_AGG_FN.has(lower))  return 'tk-op-log'; // reuse the logical-keyword color
  if (schema.relations.includes(text)) return 'tk-rel';
  if (schema.columns.includes(text))   return 'tk-col';
  // Qualified suffix: previous non-ws was '.' → treat as column part of R.col
  if (prevNonWs === '.') return 'tk-col';
  return 'tk-ident';
}

export function highlight(query: string, schema: HighlightSchema): React.ReactNode[] {
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
    // update prevNonWs from the last non-space char of `text`
    for (let j = text.length - 1; j >= 0; j--) {
      if (!/\s/.test(text[j])) { prevNonWs = text[j]; break; }
    }
  };

  while (i < query.length) {
    const c = query[i];

    // Comment: # to end of line
    if (c === '#') {
      const nl = query.indexOf('\n', i);
      const stop = nl < 0 ? query.length : nl;
      push(query.slice(i, stop), 'tk-comment');
      i = stop;
      continue;
    }

    // Whitespace (don't update prevNonWs)
    if (/\s/.test(c)) {
      let j = i;
      while (j < query.length && /\s/.test(query[j])) j++;
      out.push(<React.Fragment key={key++}>{query.slice(i, j)}</React.Fragment>);
      i = j;
      continue;
    }

    // String (single or double-quoted)
    if (c === '\'' || c === '"') {
      const quote = c;
      let j = i + 1;
      while (j < query.length && query[j] !== quote) {
        if (query[j] === '\\' && j + 1 < query.length) j++;
        j++;
      }
      if (j < query.length) j++; // include closing quote
      push(query.slice(i, j), 'tk-val-str');
      i = j;
      continue;
    }

    // Number
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

    // Multi-char punctuation/operators
    if (c === ':' && query[i + 1] === '=') { push(':=', 'tk-assign'); i += 2; continue; }
    if (c === '-' && query[i + 1] === '>') { push('->', 'tk-arrow'); i += 2; continue; }
    if (c === '<' && query[i + 1] === '=') { push('<=', 'tk-cmp'); i += 2; continue; }
    if (c === '>' && query[i + 1] === '=') { push('>=', 'tk-cmp'); i += 2; continue; }
    if (c === '!' && query[i + 1] === '=') { push('!=', 'tk-cmp'); i += 2; continue; }

    // Single-char Unicode operators
    if (UNICODE_UNARY.includes(c)) { push(c, 'tk-op-unary'); i++; continue; }
    if (UNICODE_BIN.includes(c))   { push(c, 'tk-op-bin');   i++; continue; }
    if (UNICODE_LOG.includes(c))   { push(c, 'tk-op-log');   i++; continue; }
    if (UNICODE_CMP.includes(c))   { push(c, 'tk-cmp');      i++; continue; }
    if (UNICODE_ARROW.includes(c)) { push(c, 'tk-arrow');    i++; continue; }

    // ASCII comparators (single char)
    if (c === '=' || c === '<' || c === '>') { push(c, 'tk-cmp'); i++; continue; }

    // Punctuation
    if ('(){},;_.'.includes(c)) { push(c, 'tk-punct'); i++; continue; }

    // Identifier / keyword
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < query.length && /[a-zA-Z0-9_]/.test(query[j])) j++;
      const text = query.slice(i, j);
      push(text, classify(text, prevNonWs, schema));
      i = j;          // ← bug fix: advance past the consumed identifier
      continue;
    }

    // Anything else — pass through uncolored
    push(c, '');
    i++;
  }

  // Add a trailing newline space so a final newline keeps the layout aligned
  out.push(<React.Fragment key={key++}>{'\n'}</React.Fragment>);
  return out;
}

// Intelligent autocomplete for the relational-algebra editor.
//
// Walks the token stream up to the caret as if running a simplified parser,
// keeping track of what construct we are inside and what the next legal
// token can be. The output is a ranked list of suggestions filtered by the
// partial word the user is typing.

import { tokenize } from '../../utils/relAlgebra/tokenizer';
import type { Token, TokenKind } from '../../utils/relAlgebra/tokenizer';

export interface PredictContext {
  relations: string[];                       // schema tables + imported
  columnsByRel: Map<string, string[]>;       // column names per relation
  allColumns: string[];                      // distinct union of all column names
  sampleValuesByCol: Map<string, string[]>;  // 'relation.column' → up to 5 sample stringified values
  derivedRelations: string[];                // R := … names available later in the program
}

export interface Suggestion {
  text: string;
  label: string;
  hint?: string;
  kind: 'relation' | 'column' | 'operator' | 'literal' | 'template' | 'keyword';
  /** Padding policy at insertion time. */
  pad?: 'name' | 'binary' | 'comma' | 'lparen' | 'punct' | 'none';
  /** When set, caret jumps to this offset within `text` instead of the end
   *  (used by templates with placeholders to land the user on the first hole). */
  caretOffset?: number;
}

/**
 * The walker state. Each mode tells us what kind of token we expect NEXT.
 *
 *   START_REL        → expect a relation reference, '(', σ, π, ρ, or an
 *                      assignment target IDENT followed by ':='.
 *   AFTER_REL        → just consumed a relation expression; expect binary
 *                      operator (⋈ ⨯ ÷ ∪ ∩ −), ';' or end.
 *   IN_SELECT_START  → just after σ; entering the condition body.
 *   COND_OPERAND     → expect an operand (column / literal / '¬' / '(').
 *   COND_AFTER_COL   → just consumed a column; expect a comparison op.
 *   COND_AFTER_CMP   → just consumed a comparison op; expect a value/column.
 *   COND_DONE        → comparison complete; expect ∧ ∨ ')' or '(' for relarg.
 *   IN_PROJECT_START → just after π; entering the column list.
 *   PROJECT_AFTER_COL→ a column was consumed; expect ',' or '('.
 *   IN_RENAME_START  → just after ρ; entering the body.
 *   RENAME_FIRST     → first identifier consumed; expect '→' or '('.
 *   RENAME_AFTER_ARROW → expect target identifier.
 *   RENAME_AFTER_PAIR  → pair complete; expect ',' or '('.
 */
type Mode =
  | 'START_REL'
  | 'AFTER_REL'
  | 'IN_SELECT_START'
  | 'COND_OPERAND'
  | 'COND_AFTER_COL'
  | 'COND_AFTER_CMP'
  | 'COND_DONE'
  | 'IN_PROJECT_START'
  | 'PROJECT_AFTER_COL'
  | 'IN_RENAME_START'
  | 'RENAME_FIRST'
  | 'RENAME_AFTER_ARROW'
  | 'RENAME_AFTER_PAIR'
  | 'EXPECT_REL_ARG'   // expect '(' opening the relation argument of σ/π/ρ
  | 'EXPECT_REL_REF'   // inside parens, expect a relation reference
  | 'ERROR_RECOVERY';  // saw a token that doesn't fit current grammar — stop transitioning until a hard reset (; or end)

interface Frame {
  mode: Mode;
  /** Name of the relation argument once we see one in scope (best-effort
   *  inference for column scoping inside σ/π/ρ bodies). */
  relInScope?: string;
  /** Column from the last "col cmp ?" comparison, used to drive sample-value
   *  suggestions for the RHS literal. */
  lastCmpCol?: string;
}

const BINARY_OP_KINDS: TokenKind[] = ['OP_JOIN', 'OP_CROSS', 'OP_UNION', 'OP_INTERSECT', 'OP_DIFFERENCE', 'OP_DIVISION'];
const CMP_KINDS: TokenKind[] = ['EQ', 'NEQ', 'LT', 'GT', 'LE', 'GE'];
const VALUE_KINDS: TokenKind[] = ['NUMBER', 'STRING', 'BOOL'];

/** Stripped-down word-at-caret detector. Includes '.' so qualified refs
 *  R.col stay as one unit. */
export function wordAtCaret(query: string, caretPos: number): { word: string; start: number } {
  let i = caretPos;
  while (i > 0 && /[a-zA-Z0-9_.]/.test(query[i - 1])) i--;
  return { word: query.slice(i, caretPos), start: i };
}

/**
 * Main entry. Returns up to 12 ranked suggestions for the cursor position.
 */
export function predictNext(
  query: string,
  caretPos: number,
  ctx: PredictContext,
): Suggestion[] {
  const { word, start: wordStart } = wordAtCaret(query, caretPos);
  const prefix = query.slice(0, wordStart);

  // Try to tokenize. If lexing fails partway, use the tokens we got.
  let tokens: Token[] = [];
  try {
    tokens = tokenize(prefix).filter(t => t.kind !== 'EOF');
  } catch {
    // Partial input — fall back to empty tokens, mode stays at start.
  }

  const frame = walk(tokens);

  // Forward scan: peek into the text AFTER the caret to find the relation
  // argument of the σ/π/ρ whose body we're currently in. When found, restrict
  // column suggestions to that relation's columns instead of showing every
  // column from every loaded relation.
  const scopeRelation = isBodyMode(frame.mode) ? findScopeRelation(query, caretPos, ctx) : null;

  const wordLower = word.toLowerCase();
  const tail = wordLower.includes('.') ? wordLower.split('.').pop() ?? '' : wordLower;

  const candidates = suggestionsFor(frame, ctx, word, scopeRelation);

  if (!tail) return candidates.slice(0, 12);
  // Strict prefix filter — when the user is typing a word, we don't show
  // candidates that don't continue what they're typing (showing "= ≠ <" while
  // they're typing a column name is misleading).
  const exact = candidates.filter(s => s.label.toLowerCase().startsWith(tail));
  return exact.slice(0, 12);
}

const BODY_MODES: Set<Mode> = new Set([
  'IN_SELECT_START', 'COND_OPERAND', 'COND_AFTER_COL', 'COND_AFTER_CMP', 'COND_DONE',
  'IN_PROJECT_START', 'PROJECT_AFTER_COL',
  'IN_RENAME_START', 'RENAME_FIRST', 'RENAME_AFTER_ARROW', 'RENAME_AFTER_PAIR',
]);
function isBodyMode(m: Mode): boolean { return BODY_MODES.has(m); }

/**
 * Look at the text AFTER the caret and find the relation reference that
 * sits inside the parenthesised argument of the current σ/π/ρ. Returns the
 * relation name if we can recognise it; null otherwise.
 *
 * Algorithm: scan the suffix one token at a time, tracking paren depth from
 * 0. The first IDENT we encounter inside the first balanced (…) at depth 1
 * is taken as the scope relation. Robust to:
 *   - σ a = 3 (works)      → works
 *   - σ_{a = 3}(works)      → works (we treat any IDENT inside parens)
 *   - σ a = 3 (π eid (emp)) → emp (recurses via the same heuristic when the
 *     immediate child is again a σ/π/ρ)
 */
function findScopeRelation(query: string, caretPos: number, ctx: PredictContext): string | null {
  const suffix = query.slice(caretPos);
  let suffixTokens: Token[] = [];
  try { suffixTokens = tokenize(suffix).filter(t => t.kind !== 'EOF'); }
  catch { return null; }

  let depth = 0;
  let inParenArg = false;
  for (let i = 0; i < suffixTokens.length; i++) {
    const t = suffixTokens[i];
    if (t.kind === 'LPAREN' || t.kind === 'LBRACE') {
      // Skip the brace-form body — we want the first top-level paren AFTER
      // the closing brace.
      if (t.kind === 'LPAREN' && depth === 0) inParenArg = true;
      depth++;
      continue;
    }
    if (t.kind === 'RPAREN' || t.kind === 'RBRACE') {
      depth--;
      if (depth === 0) inParenArg = false;
      continue;
    }
    if (!inParenArg) continue;
    if (t.kind === 'IDENT') {
      const name = t.text;
      // Skip if it's the LHS of a comparison inside the paren body
      // (rare nested case); only accept names that are known relations.
      if (ctx.relations.includes(name) || ctx.derivedRelations.includes(name)) {
        return name;
      }
    }
  }
  return null;
}

/** Walk tokens left-to-right, return the final state. Unexpected tokens trip
 *  the walker into ERROR_RECOVERY so we don't keep transitioning over a
 *  malformed prefix and end up suggesting "continuations" of a broken query. */
function walk(tokens: Token[]): Frame {
  const stack: Frame[] = [{ mode: 'START_REL' }];

  const top = (): Frame => stack[stack.length - 1];
  const setMode = (m: Mode) => { top().mode = m; };
  const push = (m: Mode) => { stack.push({ mode: m }); };
  const pop = () => { if (stack.length > 1) stack.pop(); };
  /** When a token doesn't match any case in the current mode, treat it as an
   *  error and drop to ERROR_RECOVERY rather than ignoring it (which would
   *  let the next legal-looking token misleadingly advance state). */
  const trap = () => { setMode('ERROR_RECOVERY'); };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const m = top().mode;

    // SEMI always resets to a fresh statement, even from ERROR_RECOVERY.
    if (t.kind === 'SEMI') { setMode('START_REL'); continue; }
    if (m === 'ERROR_RECOVERY') continue; // skip rest of statement after error

    switch (m) {
      case 'START_REL':
      case 'EXPECT_REL_REF':
      case 'AFTER_REL': {
        // Allow assignment: IDENT ':=' …
        if (m === 'START_REL' && t.kind === 'IDENT' && tokens[i + 1]?.kind === 'ASSIGN') {
          i++; setMode('START_REL'); break;
        }
        if (t.kind === 'OP_SELECT')  { setMode('IN_SELECT_START');  break; }
        if (t.kind === 'OP_PROJECT') { setMode('IN_PROJECT_START'); break; }
        if (t.kind === 'OP_RENAME')  { setMode('IN_RENAME_START');  break; }
        if (t.kind === 'LPAREN')     { push('EXPECT_REL_REF'); break; }
        if (t.kind === 'RPAREN')     { pop(); setMode('AFTER_REL'); break; }
        if (t.kind === 'IDENT')      { setMode('AFTER_REL'); break; }
        if (BINARY_OP_KINDS.includes(t.kind)) { setMode('START_REL'); break; }
        if (t.kind === 'DOT')        { /* part of qualified name; stay */ break; }
        // AFTER_REL also accepts ';' but SEMI is handled above the switch.
        trap(); break;
      }

      case 'IN_SELECT_START':
      case 'COND_OPERAND': {
        if (t.kind === 'UNDERSCORE') break;
        if (t.kind === 'LBRACE')     { setMode('COND_OPERAND'); break; }
        if (t.kind === 'NOT')        { setMode('COND_OPERAND'); break; }
        if (t.kind === 'LPAREN')     { setMode('COND_OPERAND'); break; }
        if (t.kind === 'IDENT')      {
          top().lastCmpCol = t.text;
          setMode('COND_AFTER_COL'); break;
        }
        if (VALUE_KINDS.includes(t.kind)) { setMode('COND_DONE'); break; }
        trap(); break;
      }

      case 'COND_AFTER_COL': {
        if (CMP_KINDS.includes(t.kind)) { setMode('COND_AFTER_CMP'); break; }
        if (t.kind === 'DOT')           { break; }
        if (t.kind === 'IDENT')         { setMode('COND_AFTER_COL'); break; }
        trap(); break;
      }

      case 'COND_AFTER_CMP': {
        if (t.kind === 'IDENT' || VALUE_KINDS.includes(t.kind)) { setMode('COND_DONE'); break; }
        trap(); break;
      }

      case 'COND_DONE': {
        if (t.kind === 'AND' || t.kind === 'OR') { setMode('COND_OPERAND'); break; }
        if (t.kind === 'RBRACE') { setMode('EXPECT_REL_ARG'); break; }
        if (t.kind === 'LPAREN') { push('EXPECT_REL_REF'); break; }
        if (t.kind === 'RPAREN') { /* close a (cond) group */ break; }
        trap(); break;
      }

      case 'EXPECT_REL_ARG': {
        if (t.kind === 'LPAREN') { push('EXPECT_REL_REF'); break; }
        trap(); break;
      }

      case 'IN_PROJECT_START':
      case 'PROJECT_AFTER_COL': {
        if (t.kind === 'UNDERSCORE') break;
        if (t.kind === 'LBRACE')     { setMode('IN_PROJECT_START'); break; }
        if (t.kind === 'COMMA')      { setMode('IN_PROJECT_START'); break; }
        if (t.kind === 'IDENT')      { setMode('PROJECT_AFTER_COL'); break; }
        if (t.kind === 'DOT')        { setMode('IN_PROJECT_START'); break; }
        if (t.kind === 'RBRACE')     { setMode('EXPECT_REL_ARG'); break; }
        // Only allow LPAREN right after a column (IDENT) — never after junk
        if (t.kind === 'LPAREN' && m === 'PROJECT_AFTER_COL') { push('EXPECT_REL_REF'); break; }
        trap(); break;
      }

      case 'IN_RENAME_START': {
        if (t.kind === 'UNDERSCORE') break;
        if (t.kind === 'LBRACE')     break;
        if (t.kind === 'IDENT')      { setMode('RENAME_FIRST'); break; }
        if (t.kind === 'LPAREN')     { push('EXPECT_REL_REF'); break; }
        trap(); break;
      }

      case 'RENAME_FIRST': {
        if (t.kind === 'ARROW')      { setMode('RENAME_AFTER_ARROW'); break; }
        if (t.kind === 'RBRACE')     { setMode('EXPECT_REL_ARG'); break; }
        if (t.kind === 'LPAREN')     { push('EXPECT_REL_REF'); break; }
        trap(); break;
      }

      case 'RENAME_AFTER_ARROW': {
        if (t.kind === 'IDENT') { setMode('RENAME_AFTER_PAIR'); break; }
        trap(); break;
      }

      case 'RENAME_AFTER_PAIR': {
        if (t.kind === 'COMMA')  { setMode('IN_RENAME_START'); break; }
        if (t.kind === 'RBRACE') { setMode('EXPECT_REL_ARG'); break; }
        if (t.kind === 'LPAREN') { push('EXPECT_REL_REF'); break; }
        trap(); break;
      }
    }
  }

  return top();
}

/** Build the suggestion list for the current state. */
function suggestionsFor(
  frame: Frame,
  ctx: PredictContext,
  word: string,
  scopeRelation: string | null = null,
): Suggestion[] {
  const out: Suggestion[] = [];

  // Helpers
  const push = (s: Suggestion) => out.push(s);
  const relations = (hint?: string) => {
    ctx.relations.forEach(r => push({ text: r, label: r, hint, kind: 'relation' }));
    ctx.derivedRelations.forEach(r => push({ text: r, label: r, hint: 'derivada', kind: 'relation' }));
  };
  /** Columns visible from the current parser position. If we know which
   *  relation the σ/π/ρ body operates on, restrict to its columns only —
   *  this keeps the chip list and the ghost suggestion focused on what
   *  actually exists in scope instead of every column from every loaded
   *  relation. */
  const allColumns = (hint?: string) => {
    if (scopeRelation) {
      const cols = ctx.columnsByRel.get(scopeRelation);
      if (cols && cols.length > 0) {
        cols.forEach(c => push({ text: c, label: c, hint: hint ?? scopeRelation, kind: 'column' }));
        return;
      }
    }
    ctx.allColumns.forEach(c => push({ text: c, label: c, hint, kind: 'column' }));
  };

  switch (frame.mode) {
    case 'START_REL':
    case 'EXPECT_REL_REF': {
      // Templates only at the very start (no partial word typed yet)
      if (word === '' && frame.mode === 'START_REL') {
        push({ text: 'σ COL = VAL (REL)', label: 'σ COL = VAL (REL)', hint: 'selección', kind: 'template', pad: 'none', caretOffset: 2 });
        push({ text: 'π COL (REL)', label: 'π COL (REL)', hint: 'proyección', kind: 'template', pad: 'none', caretOffset: 2 });
        push({ text: 'R := EXPR', label: 'R := EXPR', hint: 'asignación', kind: 'template', pad: 'none', caretOffset: 0 });
      }
      push({ text: 'σ', label: 'σ', hint: 'selección', kind: 'operator', pad: 'binary' });
      push({ text: 'π', label: 'π', hint: 'proyección', kind: 'operator', pad: 'binary' });
      push({ text: 'ρ', label: 'ρ', hint: 'renombrar', kind: 'operator', pad: 'binary' });
      relations();
      break;
    }

    case 'AFTER_REL': {
      push({ text: '⋈', label: '⋈', hint: 'junta natural', kind: 'operator', pad: 'binary' });
      push({ text: '⨯', label: '⨯', hint: 'producto cartesiano', kind: 'operator', pad: 'binary' });
      push({ text: '÷', label: '÷', hint: 'división', kind: 'operator', pad: 'binary' });
      push({ text: '∪', label: '∪', hint: 'unión', kind: 'operator', pad: 'binary' });
      push({ text: '∩', label: '∩', hint: 'intersección', kind: 'operator', pad: 'binary' });
      push({ text: '−', label: '−', hint: 'diferencia', kind: 'operator', pad: 'binary' });
      push({ text: ';', label: ';', hint: 'siguiente sentencia', kind: 'keyword', pad: 'punct' });
      break;
    }

    case 'IN_SELECT_START':
    case 'COND_OPERAND': {
      // Need a column (left operand) — show all columns.
      allColumns('columna');
      push({ text: '¬', label: '¬', hint: 'NOT lógico', kind: 'operator', pad: 'binary' });
      break;
    }

    case 'COND_AFTER_COL': {
      push({ text: '=',  label: '=',  hint: 'igual',            kind: 'operator', pad: 'binary' });
      push({ text: '≠',  label: '≠',  hint: 'distinto',         kind: 'operator', pad: 'binary' });
      push({ text: '<',  label: '<',  hint: 'menor',            kind: 'operator', pad: 'binary' });
      push({ text: '>',  label: '>',  hint: 'mayor',            kind: 'operator', pad: 'binary' });
      push({ text: '≤',  label: '≤',  hint: 'menor o igual',    kind: 'operator', pad: 'binary' });
      push({ text: '≥',  label: '≥',  hint: 'mayor o igual',    kind: 'operator', pad: 'binary' });
      break;
    }

    case 'COND_AFTER_CMP': {
      // RHS of a comparison — suggest sample values from the LHS column.
      // If we know the relation in scope, prefer that relation's column
      // exact match (so values are real for THIS query, not from elsewhere).
      const col = frame.lastCmpCol ?? '';
      const samples = sampleValuesForColumn(col, ctx, scopeRelation);
      samples.forEach(v => push({ text: v, label: v, hint: `valor de ${col}`, kind: 'literal', pad: 'name' }));
      allColumns('columna');
      break;
    }

    case 'COND_DONE': {
      push({ text: '∧', label: '∧', hint: 'Y lógico (AND)', kind: 'operator', pad: 'binary' });
      push({ text: '∨', label: '∨', hint: 'O lógico (OR)',  kind: 'operator', pad: 'binary' });
      push({ text: ')', label: ')', hint: 'cerrar grupo',    kind: 'keyword',  pad: 'punct' });
      push({ text: '(', label: '(', hint: 'abrir relación',  kind: 'keyword',  pad: 'lparen' });
      break;
    }

    case 'EXPECT_REL_ARG': {
      push({ text: '(', label: '(', hint: 'abrir relación', kind: 'keyword', pad: 'lparen' });
      break;
    }

    case 'IN_PROJECT_START': {
      allColumns('columna a proyectar');
      break;
    }

    case 'PROJECT_AFTER_COL': {
      push({ text: ',', label: ',', hint: 'agregar otra columna', kind: 'keyword', pad: 'comma' });
      push({ text: '(', label: '(', hint: 'abrir relación',       kind: 'keyword', pad: 'lparen' });
      break;
    }

    case 'IN_RENAME_START': {
      // First ident inside ρ — could be a new relation name (alias) or a column on the LHS of "a→b".
      allColumns('columna o nuevo nombre');
      break;
    }

    case 'RENAME_FIRST': {
      push({ text: '→', label: '→', hint: 'renombrar a', kind: 'operator', pad: 'binary' });
      push({ text: '(', label: '(', hint: 'abrir relación', kind: 'keyword', pad: 'lparen' });
      break;
    }

    case 'RENAME_AFTER_ARROW': {
      push({ text: 'nuevo_nombre', label: 'nuevo_nombre', hint: 'identificador', kind: 'literal', pad: 'name' });
      break;
    }

    case 'RENAME_AFTER_PAIR': {
      push({ text: ',', label: ',', hint: 'renombrar otra columna', kind: 'keyword', pad: 'comma' });
      push({ text: '(', label: '(', hint: 'abrir relación',         kind: 'keyword', pad: 'lparen' });
      break;
    }

    case 'ERROR_RECOVERY': {
      // The prefix has a syntactic mistake the walker couldn't fit into the
      // grammar. Suggest minimal recovery options so the user can either
      // start a new sentence or revisit what they wrote.
      push({ text: ';', label: ';', hint: 'cerrar y empezar nueva sentencia', kind: 'keyword', pad: 'punct' });
      push({ text: '(', label: '(', hint: 'abrir paréntesis', kind: 'keyword', pad: 'lparen' });
      push({ text: ')', label: ')', hint: 'cerrar paréntesis', kind: 'keyword', pad: 'punct' });
      break;
    }
  }

  return out;
}

/** Return up to 5 sample distinct values stringified for a column. When a
 *  relation scope is known, prefer that relation's exact column; otherwise
 *  fall back to the first relation that has a matching column name. */
function sampleValuesForColumn(col: string, ctx: PredictContext, scopeRelation: string | null = null): string[] {
  if (!col) return [];
  if (scopeRelation) {
    const exact = ctx.sampleValuesByCol.get(`${scopeRelation}.${col}`);
    if (exact && exact.length > 0) return exact.slice(0, 5);
  }
  for (const [key, vals] of ctx.sampleValuesByCol.entries()) {
    if (key === col || key.endsWith('.' + col)) {
      return vals.slice(0, 5);
    }
  }
  return [];
}

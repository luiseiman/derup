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
  | 'EXPECT_REL_REF';  // inside parens, expect a relation reference

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

  // Build the candidate set first, then filter by the partial word.
  const candidates = suggestionsFor(frame, ctx, word);

  // Mid-word: rank candidates whose label starts with the word.
  const wordLower = word.toLowerCase();
  const tail = wordLower.includes('.') ? wordLower.split('.').pop() ?? '' : wordLower;

  let filtered = candidates;
  if (tail) {
    const exact = candidates.filter(s => s.label.toLowerCase().startsWith(tail));
    if (exact.length > 0) filtered = exact;
    // If nothing matches the prefix, keep showing all candidates so the
    // user can see what's structurally valid; their typo will be obvious.
  }

  return filtered.slice(0, 12);
}

/** Walk tokens left-to-right, return the final state. */
function walk(tokens: Token[]): Frame {
  const stack: Frame[] = [{ mode: 'START_REL' }];

  const top = (): Frame => stack[stack.length - 1];
  const setMode = (m: Mode) => { top().mode = m; };
  const push = (m: Mode) => { stack.push({ mode: m }); };
  const pop = () => { if (stack.length > 1) stack.pop(); };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const m = top().mode;

    switch (m) {
      case 'START_REL':
      case 'EXPECT_REL_REF':
      case 'AFTER_REL': {
        // Allow assignment: IDENT ':=' …
        if (m === 'START_REL' && t.kind === 'IDENT' && tokens[i + 1]?.kind === 'ASSIGN') {
          // Skip name + := token to continue parsing the RHS as a fresh START_REL.
          i++; // skip ASSIGN next iteration via the loop increment
          setMode('START_REL');
          break;
        }

        if (t.kind === 'OP_SELECT')  { setMode('IN_SELECT_START');  break; }
        if (t.kind === 'OP_PROJECT') { setMode('IN_PROJECT_START'); break; }
        if (t.kind === 'OP_RENAME')  { setMode('IN_RENAME_START');  break; }

        if (t.kind === 'LPAREN') {
          push('EXPECT_REL_REF');
          break;
        }
        if (t.kind === 'RPAREN') {
          pop();
          setMode('AFTER_REL');
          break;
        }
        if (t.kind === 'IDENT') {
          setMode('AFTER_REL');
          break;
        }
        if (BINARY_OP_KINDS.includes(t.kind)) {
          // Need another relation expression on the right.
          setMode('START_REL');
          break;
        }
        if (t.kind === 'SEMI') {
          setMode('START_REL');
          break;
        }
        break;
      }

      case 'IN_SELECT_START':
      case 'COND_OPERAND': {
        if (t.kind === 'UNDERSCORE') break;
        if (t.kind === 'LBRACE')     { setMode('COND_OPERAND'); break; }
        if (t.kind === 'NOT')        { setMode('COND_OPERAND'); break; }
        if (t.kind === 'LPAREN')     { setMode('COND_OPERAND'); break; }
        if (t.kind === 'IDENT')      {
          top().lastCmpCol = t.text;
          setMode('COND_AFTER_COL');
          break;
        }
        if (VALUE_KINDS.includes(t.kind)) {
          setMode('COND_DONE');
          break;
        }
        break;
      }

      case 'COND_AFTER_COL': {
        if (CMP_KINDS.includes(t.kind)) { setMode('COND_AFTER_CMP'); break; }
        if (t.kind === 'DOT')           { /* qualified name; stay until next IDENT */ break; }
        if (t.kind === 'IDENT')         { /* second half of R.col */ setMode('COND_AFTER_COL'); break; }
        break;
      }

      case 'COND_AFTER_CMP': {
        if (t.kind === 'IDENT' || VALUE_KINDS.includes(t.kind)) {
          setMode('COND_DONE');
          break;
        }
        break;
      }

      case 'COND_DONE': {
        if (t.kind === 'AND' || t.kind === 'OR') { setMode('COND_OPERAND'); break; }
        if (t.kind === 'RBRACE') {
          // End of explicit {cond}; now expect '(' rel arg.
          setMode('EXPECT_REL_ARG');
          break;
        }
        if (t.kind === 'LPAREN') {
          // Simplified form: condition ended, this '(' opens the rel arg.
          push('EXPECT_REL_REF');
          break;
        }
        break;
      }

      case 'EXPECT_REL_ARG': {
        if (t.kind === 'LPAREN') { push('EXPECT_REL_REF'); break; }
        break;
      }

      case 'IN_PROJECT_START':
      case 'PROJECT_AFTER_COL': {
        if (t.kind === 'UNDERSCORE') break;
        if (t.kind === 'LBRACE')     { setMode('IN_PROJECT_START'); break; }
        if (t.kind === 'COMMA')      { setMode('IN_PROJECT_START'); break; }
        if (t.kind === 'IDENT')      { setMode('PROJECT_AFTER_COL'); break; }
        if (t.kind === 'DOT')        { setMode('IN_PROJECT_START'); break; }
        if (t.kind === 'RBRACE')     { setMode('EXPECT_REL_ARG'); break; }
        if (t.kind === 'LPAREN')     { push('EXPECT_REL_REF'); break; }
        break;
      }

      case 'IN_RENAME_START': {
        if (t.kind === 'UNDERSCORE') break;
        if (t.kind === 'LBRACE')     break;
        if (t.kind === 'IDENT')      { setMode('RENAME_FIRST'); break; }
        if (t.kind === 'LPAREN')     { push('EXPECT_REL_REF'); break; }
        break;
      }

      case 'RENAME_FIRST': {
        if (t.kind === 'ARROW')      { setMode('RENAME_AFTER_ARROW'); break; }
        if (t.kind === 'RBRACE')     { setMode('EXPECT_REL_ARG'); break; }
        if (t.kind === 'LPAREN')     { push('EXPECT_REL_REF'); break; }
        break;
      }

      case 'RENAME_AFTER_ARROW': {
        if (t.kind === 'IDENT') { setMode('RENAME_AFTER_PAIR'); break; }
        break;
      }

      case 'RENAME_AFTER_PAIR': {
        if (t.kind === 'COMMA')  { setMode('IN_RENAME_START'); break; }
        if (t.kind === 'RBRACE') { setMode('EXPECT_REL_ARG'); break; }
        if (t.kind === 'LPAREN') { push('EXPECT_REL_REF'); break; }
        break;
      }
    }
  }

  return top();
}

/** Build the suggestion list for the current state. */
function suggestionsFor(frame: Frame, ctx: PredictContext, word: string): Suggestion[] {
  const out: Suggestion[] = [];

  // Helpers
  const push = (s: Suggestion) => out.push(s);
  const relations = (hint?: string) => {
    ctx.relations.forEach(r => push({ text: r, label: r, hint, kind: 'relation' }));
    ctx.derivedRelations.forEach(r => push({ text: r, label: r, hint: 'derivada', kind: 'relation' }));
  };
  const allColumns = (hint?: string) =>
    ctx.allColumns.forEach(c => push({ text: c, label: c, hint, kind: 'column' }));

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
      // RHS of a comparison — suggest sample values from the column AND other columns.
      const col = frame.lastCmpCol ?? '';
      const samples = sampleValuesForColumn(col, ctx);
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
  }

  return out;
}

/** Return up to 5 sample distinct values stringified for a column. Tries to
 *  match a "rel.col" key first, otherwise picks the first relation that has
 *  the column. */
function sampleValuesForColumn(col: string, ctx: PredictContext): string[] {
  if (!col) return [];
  // Direct lookup by qualified key first
  for (const [key, vals] of ctx.sampleValuesByCol.entries()) {
    if (key === col || key.endsWith('.' + col)) {
      return vals.slice(0, 5);
    }
  }
  return [];
}

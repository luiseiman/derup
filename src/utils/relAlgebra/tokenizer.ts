// Lexer for the relational-algebra mini-language.
// Accepts both Unicode (σ π ⋈ ⨯ ∪ ∩ - ρ ∧ ∨ ¬ ≠ ≤ ≥) and ASCII keywords
// (select project join cross union intersect difference rename and or not != <= >=).

import type { SrcPos } from './types';
import { RAError } from './types';

export type TokenKind =
  | 'OP_SELECT' | 'OP_PROJECT' | 'OP_RENAME'
  | 'OP_JOIN' | 'OP_CROSS' | 'OP_UNION' | 'OP_INTERSECT' | 'OP_DIFFERENCE' | 'OP_DIVISION'
  | 'AND' | 'OR' | 'NOT'
  | 'EQ' | 'NEQ' | 'LT' | 'GT' | 'LE' | 'GE'
  | 'ASSIGN' | 'ARROW' | 'COMMA' | 'SEMI' | 'DOT'
  | 'LPAREN' | 'RPAREN' | 'LBRACE' | 'RBRACE'
  | 'UNDERSCORE'
  | 'IDENT' | 'NUMBER' | 'STRING' | 'BOOL'
  | 'EOF';

export interface Token {
  kind: TokenKind;
  text: string;
  pos: SrcPos;
}

const KEYWORDS: Record<string, TokenKind> = {
  select: 'OP_SELECT',
  project: 'OP_PROJECT',
  rename: 'OP_RENAME',
  join: 'OP_JOIN',
  cross: 'OP_CROSS',
  union: 'OP_UNION',
  intersect: 'OP_INTERSECT',
  difference: 'OP_DIFFERENCE',
  division: 'OP_DIVISION',
  and: 'AND',
  or: 'OR',
  not: 'NOT',
  true: 'BOOL',
  false: 'BOOL',
};

const UNICODE_OPS: Record<string, TokenKind> = {
  'σ': 'OP_SELECT',
  'π': 'OP_PROJECT',
  'ρ': 'OP_RENAME',
  '⋈': 'OP_JOIN',
  '⨝': 'OP_JOIN',
  '⨯': 'OP_CROSS',
  '×': 'OP_CROSS',
  '∪': 'OP_UNION',
  '∩': 'OP_INTERSECT',
  '−': 'OP_DIFFERENCE',
  '÷': 'OP_DIVISION',
  '∧': 'AND',
  '∨': 'OR',
  '¬': 'NOT',
  '≠': 'NEQ',
  '≤': 'LE',
  '≥': 'GE',
  '→': 'ARROW',
};

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const makePos = (start: number, end: number): SrcPos => ({
    line,
    column: start - lineStart + 1,
    start,
    end,
  });

  while (i < input.length) {
    const ch = input[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }
    if (ch === '\n') { i++; line++; lineStart = i; continue; }

    // Comments — # to end of line
    if (ch === '#') { while (i < input.length && input[i] !== '\n') i++; continue; }

    // Multi-char operators (ASCII)
    if (ch === ':' && input[i + 1] === '=') {
      tokens.push({ kind: 'ASSIGN', text: ':=', pos: makePos(i, i + 2) });
      i += 2; continue;
    }
    if (ch === '!' && input[i + 1] === '=') {
      tokens.push({ kind: 'NEQ', text: '!=', pos: makePos(i, i + 2) });
      i += 2; continue;
    }
    if (ch === '<' && input[i + 1] === '=') {
      tokens.push({ kind: 'LE', text: '<=', pos: makePos(i, i + 2) });
      i += 2; continue;
    }
    if (ch === '>' && input[i + 1] === '=') {
      tokens.push({ kind: 'GE', text: '>=', pos: makePos(i, i + 2) });
      i += 2; continue;
    }
    if (ch === '-' && input[i + 1] === '>') {
      tokens.push({ kind: 'ARROW', text: '->', pos: makePos(i, i + 2) });
      i += 2; continue;
    }

    // Single-char Unicode operators
    if (UNICODE_OPS[ch]) {
      tokens.push({ kind: UNICODE_OPS[ch], text: ch, pos: makePos(i, i + 1) });
      i++; continue;
    }

    // Punctuation
    const singles: Record<string, TokenKind> = {
      '(': 'LPAREN', ')': 'RPAREN', '{': 'LBRACE', '}': 'RBRACE',
      ',': 'COMMA', ';': 'SEMI', '.': 'DOT',
      '_': 'UNDERSCORE',
      '=': 'EQ', '<': 'LT', '>': 'GT',
      '-': 'OP_DIFFERENCE',  // '-' is always treated as difference between rel-expressions;
                              // negative numeric literals are written without unary minus in v1.
    };
    if (singles[ch]) {
      tokens.push({ kind: singles[ch], text: ch, pos: makePos(i, i + 1) });
      i++; continue;
    }

    // Strings (single or double quoted)
    if (ch === '\'' || ch === '"') {
      const quote = ch;
      const start = i;
      i++;
      let val = '';
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          const esc = input[i + 1];
          if (esc === 'n') val += '\n';
          else if (esc === 't') val += '\t';
          else val += esc;
          i += 2;
        } else {
          val += input[i];
          i++;
        }
      }
      if (i >= input.length) {
        throw new RAError('String sin cerrar.', makePos(start, i));
      }
      i++; // consume closing quote
      tokens.push({ kind: 'STRING', text: val, pos: makePos(start, i) });
      continue;
    }

    // Numbers
    if (isDigit(ch)) {
      const start = i;
      while (i < input.length && isDigit(input[i])) i++;
      if (input[i] === '.' && isDigit(input[i + 1])) {
        i++;
        while (i < input.length && isDigit(input[i])) i++;
      }
      tokens.push({ kind: 'NUMBER', text: input.slice(start, i), pos: makePos(start, i) });
      continue;
    }

    // Identifiers / keywords
    if (isIdentStart(ch)) {
      const start = i;
      while (i < input.length && isIdentPart(input[i])) i++;
      const text = input.slice(start, i);
      const lower = text.toLowerCase();
      // Allow keyword + trailing underscore (e.g. "select_{", "project_{").
      // The trailing '_' is part of common RelaX-style syntax and is treated
      // as belonging to the operator token, not as a separate UNDERSCORE.
      if (lower.endsWith('_')) {
        const stripped = lower.slice(0, -1);
        const kwStripped = KEYWORDS[stripped];
        if (kwStripped) {
          tokens.push({ kind: kwStripped, text, pos: makePos(start, i) });
          continue;
        }
      }
      const kw = KEYWORDS[lower];
      if (kw) {
        tokens.push({ kind: kw, text, pos: makePos(start, i) });
      } else {
        tokens.push({ kind: 'IDENT', text, pos: makePos(start, i) });
      }
      continue;
    }

    throw new RAError(`Carácter inesperado: '${ch}'`, makePos(i, i + 1));
  }

  tokens.push({ kind: 'EOF', text: '', pos: makePos(i, i) });
  return tokens;
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}
function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}
function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

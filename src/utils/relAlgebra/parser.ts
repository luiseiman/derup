// Parser for the relational-algebra mini-language.
// Grammar (informal):
//
//   program     := statement (';' statement)* EOF
//   statement   := IDENT ':=' relExpr            (assignment)
//                | relExpr                       (expression)
//   relExpr     := unionExpr
//   unionExpr   := intersectExpr (('∪'|'union'|'-'|'difference') intersectExpr)*
//   intersectExpr := joinExpr (('∩'|'intersect') joinExpr)*
//   joinExpr    := unary (('⋈'|'join'|'⨯'|'cross') unary)*
//   unary       := selectExpr | projectExpr | renameExpr | primary
//   selectExpr  := ('σ'|'select') '_' '{' condition '}' '(' relExpr ')'
//   projectExpr := ('π'|'project') '_' '{' identList '}' '(' relExpr ')'
//   renameExpr  := ('ρ'|'rename') '_' '{' renameBody '}' '(' relExpr ')'
//   renameBody  := IDENT                            (relation alias)
//                | IDENT ('→'|'->') IDENT (',' IDENT ('→'|'->') IDENT)*
//   primary     := '(' relExpr ')' | IDENT
//
//   condition   := orCond
//   orCond      := andCond (('∨'|'or') andCond)*
//   andCond     := notCond (('∧'|'and') notCond)*
//   notCond     := ('¬'|'not') notCond | cmp
//   cmp         := operand cmpOp operand
//   operand     := IDENT | NUMBER | STRING | BOOL
//   cmpOp       := '=' | '!=' | '≠' | '<' | '>' | '<=' | '≤' | '>=' | '≥'

import type {
  Condition,
  CondOperand,
  CmpOp,
  Program,
  RelExpr,
  SrcPos,
  Statement,
  Value,
  ColumnType,
} from './types';
import { RAError } from './types';
import type { Token, TokenKind } from './tokenizer';
import { tokenize } from './tokenizer';

class Parser {
  private i = 0;
  private tokens: Token[];
  constructor(tokens: Token[]) { this.tokens = tokens; }

  private peek(offset = 0): Token {
    return this.tokens[this.i + offset] ?? this.tokens[this.tokens.length - 1];
  }
  private consume(): Token {
    return this.tokens[this.i++];
  }
  private match(...kinds: TokenKind[]): boolean {
    return kinds.includes(this.peek().kind);
  }
  private expect(kind: TokenKind, msg?: string): Token {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new RAError(msg ?? `Se esperaba ${kind}, se encontró '${t.text || t.kind}'`, t.pos);
    }
    return this.consume();
  }

  parseProgram(): Program {
    const statements: Statement[] = [];
    if (this.peek().kind === 'EOF') {
      throw new RAError('La consulta está vacía.', this.peek().pos);
    }
    while (this.peek().kind !== 'EOF') {
      statements.push(this.parseStatement());
      if (this.peek().kind === 'SEMI') this.consume();
    }
    return { statements };
  }

  private parseStatement(): Statement {
    // Lookahead: IDENT ':=' → assignment
    if (this.peek().kind === 'IDENT' && this.peek(1).kind === 'ASSIGN') {
      const nameTok = this.consume();
      const assignTok = this.consume();
      const expr = this.parseRelExpr();
      return { kind: 'assign', name: nameTok.text, expr, pos: spanPos(nameTok.pos, assignTok.pos) };
    }
    const start = this.peek().pos;
    const expr = this.parseRelExpr();
    return { kind: 'expr', expr, pos: start };
  }

  private parseRelExpr(): RelExpr {
    return this.parseUnion();
  }

  private parseUnion(): RelExpr {
    let left = this.parseIntersect();
    while (this.match('OP_UNION', 'OP_DIFFERENCE')) {
      const opTok = this.consume();
      const right = this.parseIntersect();
      left = {
        kind: 'binary',
        op: opTok.kind === 'OP_UNION' ? 'union' : 'difference',
        left, right,
        pos: opTok.pos,
      };
    }
    return left;
  }

  private parseIntersect(): RelExpr {
    let left = this.parseJoin();
    while (this.match('OP_INTERSECT')) {
      const opTok = this.consume();
      const right = this.parseJoin();
      left = { kind: 'binary', op: 'intersect', left, right, pos: opTok.pos };
    }
    return left;
  }

  private parseJoin(): RelExpr {
    let left = this.parseUnary();
    while (this.match('OP_JOIN', 'OP_CROSS')) {
      const opTok = this.consume();
      // Theta-join: ⋈_{cond} or ⋈{cond} or join_{cond} — only valid after ⋈, not after ⨯.
      let condition: Condition | undefined;
      if (opTok.kind === 'OP_JOIN' && (this.match('UNDERSCORE') || this.match('LBRACE'))) {
        if (this.match('UNDERSCORE')) this.consume();
        if (this.match('LBRACE')) {
          this.consume();
          condition = this.parseCondition();
          this.expect('RBRACE', "Se esperaba '}' cerrando la condición de join.");
        }
      }
      const right = this.parseUnary();
      left = {
        kind: 'binary',
        op: opTok.kind === 'OP_JOIN' ? (condition ? 'theta' : 'join') : 'cross',
        left, right,
        condition,
        pos: opTok.pos,
      };
    }
    return left;
  }

  private parseUnary(): RelExpr {
    const t = this.peek();
    if (t.kind === 'OP_SELECT') return this.parseSelect();
    if (t.kind === 'OP_PROJECT') return this.parseProject();
    if (t.kind === 'OP_RENAME') return this.parseRename();
    return this.parsePrimary();
  }

  private parseSelect(): RelExpr {
    const start = this.consume(); // σ
    // Two accepted forms:
    //   classic    : σ_{cond}(R)  or  σ{cond}(R)
    //   simplified : σ cond (R)        (RelaX / textbook style)
    if (this.match('UNDERSCORE') || this.match('LBRACE')) {
      if (this.match('UNDERSCORE')) this.consume();
      this.expect('LBRACE', "Se esperaba '{' después de σ.");
      const condition = this.parseCondition();
      this.expect('RBRACE', "Se esperaba '}' cerrando la condición.");
      this.expect('LPAREN', "Se esperaba '(' después de la condición.");
      const child = this.parseRelExpr();
      this.expect('RPAREN');
      return { kind: 'select', condition, child, pos: start.pos };
    }
    // Simplified: parse condition greedily until '(' appears (top-level).
    const condition = this.parseCondition();
    this.expect('LPAREN', "Se esperaba '(' rodeando la relación.");
    const child = this.parseRelExpr();
    this.expect('RPAREN');
    return { kind: 'select', condition, child, pos: start.pos };
  }

  private parseProject(): RelExpr {
    const start = this.consume(); // π
    if (this.match('UNDERSCORE') || this.match('LBRACE')) {
      if (this.match('UNDERSCORE')) this.consume();
      this.expect('LBRACE', "Se esperaba '{' después de π.");
      const cols: string[] = [this.parseQualifiedIdent()];
      while (this.match('COMMA')) { this.consume(); cols.push(this.parseQualifiedIdent()); }
      this.expect('RBRACE', "Se esperaba '}' cerrando la lista de columnas.");
      this.expect('LPAREN');
      const child = this.parseRelExpr();
      this.expect('RPAREN');
      return { kind: 'project', columns: cols, child, pos: start.pos };
    }
    // Simplified: π col1, col2 (R)
    const columns: string[] = [this.parseQualifiedIdent()];
    while (this.match('COMMA')) { this.consume(); columns.push(this.parseQualifiedIdent()); }
    this.expect('LPAREN', "Se esperaba '(' rodeando la relación.");
    const child = this.parseRelExpr();
    this.expect('RPAREN');
    return { kind: 'project', columns, child, pos: start.pos };
  }

  /** Read IDENT or IDENT.IDENT and return the combined name. */
  private parseQualifiedIdent(): string {
    const head = this.expect('IDENT', 'Se esperaba un identificador.');
    if (this.match('DOT')) {
      this.consume();
      const tail = this.expect('IDENT', `Se esperaba nombre de columna después de '${head.text}.'`);
      return `${head.text}.${tail.text}`;
    }
    return head.text;
  }

  private parseRename(): RelExpr {
    const start = this.consume(); // ρ
    const classic = this.match('UNDERSCORE') || this.match('LBRACE');
    if (classic) {
      if (this.match('UNDERSCORE')) this.consume();
      this.expect('LBRACE', "Se esperaba '{' después de ρ.");
    }
    // Body of ρ: either NewName, or "a → b" (possibly comma-separated list).
    const first = this.expect('IDENT', 'Se esperaba un identificador.');
    let alias: string | undefined;
    let columnMap: Record<string, string> | undefined;

    if (this.match('ARROW')) {
      this.consume();
      const renamed = this.expect('IDENT', 'Se esperaba el nuevo nombre.').text;
      columnMap = { [first.text]: renamed };
      while (this.match('COMMA')) {
        this.consume();
        const from = this.expect('IDENT', 'Se esperaba columna a renombrar.').text;
        this.expect('ARROW', "Se esperaba '→' o '->' entre los nombres.");
        const to = this.expect('IDENT', 'Se esperaba el nuevo nombre.').text;
        columnMap[from] = to;
      }
    } else {
      alias = first.text;
    }

    if (classic) this.expect('RBRACE');
    this.expect('LPAREN', "Se esperaba '(' rodeando la relación.");
    const child = this.parseRelExpr();
    this.expect('RPAREN');
    return { kind: 'rename', alias, columnMap, child, pos: start.pos };
  }

  private parsePrimary(): RelExpr {
    const t = this.peek();
    if (t.kind === 'LPAREN') {
      this.consume();
      const inner = this.parseRelExpr();
      this.expect('RPAREN');
      return inner;
    }
    if (t.kind === 'IDENT') {
      this.consume();
      return { kind: 'ref', name: t.text, pos: t.pos };
    }
    throw new RAError(`Se esperaba una expresión, se encontró '${t.text || t.kind}'.`, t.pos);
  }

  // ---------- Condition parsing ----------

  private parseCondition(): Condition {
    return this.parseOrCond();
  }

  private parseOrCond(): Condition {
    let left = this.parseAndCond();
    while (this.match('OR')) {
      const tok = this.consume();
      const right = this.parseAndCond();
      left = { kind: 'or', left, right, pos: tok.pos };
    }
    return left;
  }

  private parseAndCond(): Condition {
    let left = this.parseNotCond();
    while (this.match('AND')) {
      const tok = this.consume();
      const right = this.parseNotCond();
      left = { kind: 'and', left, right, pos: tok.pos };
    }
    return left;
  }

  private parseNotCond(): Condition {
    if (this.match('NOT')) {
      const tok = this.consume();
      const child = this.parseNotCond();
      return { kind: 'not', child, pos: tok.pos };
    }
    if (this.match('LPAREN')) {
      this.consume();
      const inner = this.parseCondition();
      this.expect('RPAREN');
      return inner;
    }
    return this.parseCmp();
  }

  private parseCmp(): Condition {
    const left = this.parseOperand();
    const t = this.peek();
    const cmpKinds: TokenKind[] = ['EQ', 'NEQ', 'LT', 'GT', 'LE', 'GE'];
    if (!cmpKinds.includes(t.kind)) {
      throw new RAError(`Se esperaba un operador de comparación, se encontró '${t.text || t.kind}'.`, t.pos);
    }
    this.consume();
    const right = this.parseOperand();
    const op: CmpOp =
      t.kind === 'EQ' ? '=' :
      t.kind === 'NEQ' ? '!=' :
      t.kind === 'LT' ? '<' :
      t.kind === 'GT' ? '>' :
      t.kind === 'LE' ? '<=' : '>=';
    return { kind: 'cmp', op, left, right, pos: t.pos };
  }

  private parseOperand(): CondOperand {
    const t = this.peek();
    if (t.kind === 'IDENT') {
      this.consume();
      // Qualified name: R.col (used after × or θ-join to disambiguate).
      if (this.match('DOT')) {
        this.consume();
        const tail = this.expect('IDENT', `Se esperaba nombre de columna después de '${t.text}.'`);
        return { kind: 'col', name: `${t.text}.${tail.text}`, pos: t.pos };
      }
      return { kind: 'col', name: t.text, pos: t.pos };
    }
    if (t.kind === 'NUMBER') {
      this.consume();
      return { kind: 'lit', value: Number(t.text) as Value, valueType: 'number', pos: t.pos };
    }
    if (t.kind === 'STRING') {
      this.consume();
      // If the string matches ISO date, also tag as date — but keep as string for compare;
      // the evaluator coerces to column type at compare time.
      return { kind: 'lit', value: t.text, valueType: 'string', pos: t.pos };
    }
    if (t.kind === 'BOOL') {
      this.consume();
      return { kind: 'lit', value: t.text.toLowerCase() === 'true', valueType: 'boolean' as ColumnType, pos: t.pos };
    }
    throw new RAError(`Se esperaba un operando (columna, número, texto o booleano).`, t.pos);
  }
}

function spanPos(a: SrcPos, b: SrcPos): SrcPos {
  return { line: a.line, column: a.column, start: a.start, end: Math.max(a.end, b.end) };
}

export function parse(input: string): Program {
  const tokens = tokenize(input);
  return new Parser(tokens).parseProgram();
}

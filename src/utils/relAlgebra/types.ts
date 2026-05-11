// Relational algebra — domain types
// All comments in English (Claude-consumed); user-facing UI is in Spanish.

export type ColumnType = 'number' | 'string' | 'date' | 'boolean';

export type Value = number | string | Date | boolean | null;

export interface Column {
  name: string;
  type: ColumnType;
}

export interface Relation {
  columns: Column[];
  rows: Value[][];
}

// ----- Source position for error reporting -----
export interface SrcPos {
  line: number;
  column: number;
  start: number;
  end: number;
}

// ----- AST: relational expression -----
export type RelExpr =
  | { kind: 'ref'; name: string; pos: SrcPos }
  | { kind: 'select'; condition: Condition; child: RelExpr; pos: SrcPos }
  | { kind: 'project'; columns: string[]; child: RelExpr; pos: SrcPos }
  | { kind: 'rename'; alias?: string; columnMap?: Record<string, string>; child: RelExpr; pos: SrcPos }
  | { kind: 'binary'; op: BinaryOp; left: RelExpr; right: RelExpr; pos: SrcPos };

export type BinaryOp = 'join' | 'cross' | 'union' | 'intersect' | 'difference';

// ----- AST: condition inside σ -----
export type Condition =
  | { kind: 'cmp'; op: CmpOp; left: CondOperand; right: CondOperand; pos: SrcPos }
  | { kind: 'and'; left: Condition; right: Condition; pos: SrcPos }
  | { kind: 'or'; left: Condition; right: Condition; pos: SrcPos }
  | { kind: 'not'; child: Condition; pos: SrcPos };

export type CmpOp = '=' | '!=' | '<' | '>' | '<=' | '>=';

export type CondOperand =
  | { kind: 'col'; name: string; pos: SrcPos }
  | { kind: 'lit'; value: Value; valueType: ColumnType; pos: SrcPos };

// ----- AST: program (sequence of assignments + optional final expression) -----
export interface Program {
  statements: Statement[];
}

export type Statement =
  | { kind: 'assign'; name: string; expr: RelExpr; pos: SrcPos }
  | { kind: 'expr'; expr: RelExpr; pos: SrcPos };

// ----- Errors -----
export class RAError extends Error {
  pos?: SrcPos;
  constructor(message: string, pos?: SrcPos) {
    super(message);
    this.name = 'RAError';
    this.pos = pos;
  }
}

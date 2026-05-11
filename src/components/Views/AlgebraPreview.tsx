// Math-style rendering of a parsed RA query — σ with the condition as a true
// subscript, π with the projection list as subscript, etc. Mirrors the
// textbook notation (Ramakrishnan, Elmasri-Navathe, De Miguel).

import type {
  CmpOp,
  Condition,
  CondOperand,
  Program,
  RelExpr,
} from '../../utils/relAlgebra/types';
import { parse } from '../../utils/relAlgebra/parser';

interface Props {
  query: string;
}

const CMP_GLYPH: Record<CmpOp, string> = {
  '=': '=', '!=': '≠', '<': '<', '>': '>', '<=': '≤', '>=': '≥',
};

const BIN_GLYPH: Record<string, string> = {
  join: '⋈',
  theta: '⋈',
  cross: '⨯',
  union: '∪',
  intersect: '∩',
  difference: '−',
};

function renderOperand(o: CondOperand): React.ReactNode {
  if (o.kind === 'col') return <span className="ra-pv-col">{o.name}</span>;
  // literal
  if (typeof o.value === 'string') return <span className="ra-pv-lit">'{o.value}'</span>;
  if (o.value instanceof Date) return <span className="ra-pv-lit">{o.value.toISOString().slice(0, 10)}</span>;
  return <span className="ra-pv-lit">{String(o.value)}</span>;
}

function renderCondition(c: Condition): React.ReactNode {
  if (c.kind === 'cmp') {
    return <>
      {renderOperand(c.left)}
      {' '}<span className="ra-pv-op">{CMP_GLYPH[c.op]}</span>{' '}
      {renderOperand(c.right)}
    </>;
  }
  if (c.kind === 'and') {
    return <>{renderCondition(c.left)} <span className="ra-pv-op">∧</span> {renderCondition(c.right)}</>;
  }
  if (c.kind === 'or') {
    return <>{renderCondition(c.left)} <span className="ra-pv-op">∨</span> {renderCondition(c.right)}</>;
  }
  // not
  return <><span className="ra-pv-op">¬</span>({renderCondition(c.child)})</>;
}

function renderExpr(e: RelExpr): React.ReactNode {
  switch (e.kind) {
    case 'ref':
      return <span className="ra-pv-rel">{e.name}</span>;
    case 'select':
      return <>
        <span className="ra-pv-greek">σ</span>
        <sub className="ra-pv-sub">{renderCondition(e.condition)}</sub>
        <span className="ra-pv-paren">(</span>
        {renderExpr(e.child)}
        <span className="ra-pv-paren">)</span>
      </>;
    case 'project':
      return <>
        <span className="ra-pv-greek">π</span>
        <sub className="ra-pv-sub">{e.columns.join(', ')}</sub>
        <span className="ra-pv-paren">(</span>
        {renderExpr(e.child)}
        <span className="ra-pv-paren">)</span>
      </>;
    case 'rename': {
      let subContent: React.ReactNode;
      if (e.columnMap) {
        const parts = Object.entries(e.columnMap).map(([from, to], i) => (
          <span key={i}>{i > 0 && ', '}{from} → {to}</span>
        ));
        subContent = <>{parts}</>;
      } else {
        subContent = <>{e.alias}</>;
      }
      return <>
        <span className="ra-pv-greek">ρ</span>
        <sub className="ra-pv-sub">{subContent}</sub>
        <span className="ra-pv-paren">(</span>
        {renderExpr(e.child)}
        <span className="ra-pv-paren">)</span>
      </>;
    }
    case 'binary': {
      const op = BIN_GLYPH[e.op] ?? e.op;
      // For theta-join, render the condition as a subscript of ⋈.
      return <>
        {renderExpr(e.left)}
        {' '}<span className="ra-pv-op">{op}</span>
        {e.op === 'theta' && e.condition && (
          <sub className="ra-pv-sub">{renderCondition(e.condition)}</sub>
        )}
        {' '}
        {renderExpr(e.right)}
      </>;
    }
  }
}

function renderProgram(p: Program): React.ReactNode {
  return (
    <>
      {p.statements.map((s, i) => (
        <div key={i} className="ra-pv-stmt">
          {s.kind === 'assign' ? (
            <>
              <span className="ra-pv-rel">{s.name}</span>
              {' '}<span className="ra-pv-op">:=</span>{' '}
              {renderExpr(s.expr)}
            </>
          ) : (
            renderExpr(s.expr)
          )}
        </div>
      ))}
    </>
  );
}

const AlgebraPreview: React.FC<Props> = ({ query }) => {
  // Strip comments before parsing — the preview ignores commented-out queries.
  const cleaned = query
    .split('\n')
    .filter(line => line.trim() !== '' && !line.trim().startsWith('#'))
    .join('\n')
    .trim();

  if (!cleaned) {
    return (
      <div className="ra-preview ra-pv-empty">
        <span style={{ color: 'var(--text-muted)' }}>Vista previa: escribí una consulta para verla con notación matemática.</span>
      </div>
    );
  }

  try {
    const program = parse(cleaned);
    return <div className="ra-preview">{renderProgram(program)}</div>;
  } catch {
    return (
      <div className="ra-preview ra-pv-invalid">
        <span style={{ color: 'var(--text-muted)' }}>Vista previa: consulta incompleta o con error de sintaxis.</span>
      </div>
    );
  }
};

export default AlgebraPreview;

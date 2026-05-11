// Execution tree for a parsed RA query. Each AST node is rendered as a box
// with the operator label and the row count of its intermediate result.
// Clicking a node tells the parent to display that intermediate relation.

import type { Condition, CondOperand, Program, RelExpr, Statement } from '../../utils/relAlgebra/types';
import type { Relation } from '../../utils/relAlgebra/types';

interface Props {
  program: Program | null;
  trace: Map<RelExpr, Relation>;
  selectedNode: RelExpr | null;
  onSelectNode: (node: RelExpr, rel: Relation) => void;
}

function operandText(o: CondOperand): string {
  if (o.kind === 'col') return o.name;
  if (typeof o.value === 'string') return `'${o.value}'`;
  if (o.value instanceof Date) return o.value.toISOString().slice(0, 10);
  return String(o.value);
}

function condText(c: Condition): string {
  if (c.kind === 'cmp') return `${operandText(c.left)} ${c.op === '!=' ? '≠' : c.op} ${operandText(c.right)}`;
  if (c.kind === 'and') return `${condText(c.left)} ∧ ${condText(c.right)}`;
  if (c.kind === 'or')  return `${condText(c.left)} ∨ ${condText(c.right)}`;
  return `¬(${condText(c.child)})`;
}

const BIN_GLYPH: Record<string, string> = {
  join: '⋈', theta: '⋈', cross: '⨯',
  union: '∪', intersect: '∩', difference: '−', division: '÷',
};

function labelOf(e: RelExpr): { glyph: string; subscript: string } {
  switch (e.kind) {
    case 'ref':       return { glyph: e.name, subscript: '' };
    case 'select':    return { glyph: 'σ', subscript: condText(e.condition) };
    case 'project':   return { glyph: 'π', subscript: e.columns.join(', ') };
    case 'rename': {
      if (e.columnMap) {
        const s = Object.entries(e.columnMap).map(([a, b]) => `${a}→${b}`).join(', ');
        return { glyph: 'ρ', subscript: s };
      }
      return { glyph: 'ρ', subscript: e.alias ?? '' };
    }
    case 'aggregate': {
      const aggList = e.aggs.map(a => `${a.func}(${a.arg})→${a.alias}`).join(', ');
      const sub = e.groupBy.length > 0 ? `${e.groupBy.join(', ')} ; ${aggList}` : aggList;
      return { glyph: 'γ', subscript: sub };
    }
    case 'binary': {
      const g = BIN_GLYPH[e.op] ?? e.op;
      const s = e.op === 'theta' && e.condition ? condText(e.condition) : '';
      return { glyph: g, subscript: s };
    }
  }
}

function childrenOf(e: RelExpr): RelExpr[] {
  switch (e.kind) {
    case 'ref': return [];
    case 'select':
    case 'project':
    case 'rename':
    case 'aggregate': return [e.child];
    case 'binary': return [e.left, e.right];
  }
}

function renderNode(
  expr: RelExpr,
  trace: Map<RelExpr, Relation>,
  selected: RelExpr | null,
  onSelect: (n: RelExpr, r: Relation) => void,
): React.ReactNode {
  const { glyph, subscript } = labelOf(expr);
  const rel = trace.get(expr);
  const rowCount = rel ? rel.rows.length : null;
  const kids = childrenOf(expr);
  const isSelected = expr === selected;
  return (
    <div className="ra-tree-node-wrap">
      <button
        className={`ra-tree-node ${expr.kind === 'ref' ? 'leaf' : 'op'} ${isSelected ? 'selected' : ''}`}
        onClick={() => rel && onSelect(expr, rel)}
        title={rel ? `${rel.rows.length} fila${rel.rows.length !== 1 ? 's' : ''} · click para ver el resultado intermedio` : ''}
      >
        <div className="ra-tree-label">
          <span className="ra-tree-glyph">{glyph}</span>
          {subscript && <sub className="ra-tree-sub">{subscript}</sub>}
        </div>
        {rowCount !== null && (
          <div className="ra-tree-count">{rowCount} fila{rowCount !== 1 ? 's' : ''}</div>
        )}
      </button>
      {kids.length > 0 && (
        <div className={`ra-tree-children ${kids.length > 1 ? 'multi' : ''}`}>
          {kids.map((c, i) => (
            <div key={i} className="ra-tree-branch">
              {renderNode(c, trace, selected, onSelect)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function renderStatement(
  s: Statement,
  i: number,
  trace: Map<RelExpr, Relation>,
  selected: RelExpr | null,
  onSelect: (n: RelExpr, r: Relation) => void,
): React.ReactNode {
  return (
    <div key={i} className="ra-tree-stmt">
      {s.kind === 'assign' && (
        <div className="ra-tree-assign">
          <span className="ra-tree-assign-name">{s.name}</span>
          <span className="ra-tree-assign-op">:=</span>
        </div>
      )}
      {renderNode(s.expr, trace, selected, onSelect)}
    </div>
  );
}

const AlgebraTree: React.FC<Props> = ({ program, trace, selectedNode, onSelectNode }) => {
  if (!program) return null;
  return (
    <div className="ra-tree-container">
      {program.statements.map((s, i) => renderStatement(s, i, trace, selectedNode, onSelectNode))}
    </div>
  );
};

export default AlgebraTree;

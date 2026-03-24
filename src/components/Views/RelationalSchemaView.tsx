import React, { useState, useRef, useEffect } from 'react';
import './RelationalSchemaView.css';
import type { RelationalSchema, RelationalTable } from '../../utils/relationalSchema';

interface RelationalSchemaViewProps {
  schema: RelationalSchema;
  selectedNodeIds?: Set<string>;
  onNavigateToNode?: (sourceId: string) => void;
  onRenameNode?: (sourceId: string, newLabel: string) => void;
}

const SOURCE_LABEL: Record<RelationalTable['source'], string> = {
  entity: 'Entidad',
  relationship: 'Relación',
  multivalued: 'Multivaluado',
  'isa-subtype': 'Subtipo ISA',
};

// ── Inline editable cell ──────────────────────────────────────────────────────

interface EditableLabelProps {
  value: string;
  sourceId?: string;
  canEdit: boolean;
  canNavigate: boolean;
  className?: string;
  onNavigate?: (sourceId: string) => void;
  onRename?: (sourceId: string, newLabel: string) => void;
}

const EditableLabel: React.FC<EditableLabelProps> = ({
  value,
  sourceId,
  canEdit,
  canNavigate,
  className,
  onNavigate,
  onRename,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, value]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value && sourceId && onRename) {
      onRename(sourceId, trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`rs-inline-input ${className ?? ''}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <span
      className={`${className ?? ''} ${canNavigate && sourceId ? 'rs-navigable' : ''} ${canEdit && sourceId ? 'rs-editable' : ''}`}
      onClick={canNavigate && sourceId ? () => onNavigate?.(sourceId) : undefined}
      onDoubleClick={canEdit && sourceId ? () => setEditing(true) : undefined}
      title={
        canEdit && sourceId
          ? 'Click: ir al nodo ER · Doble click: renombrar'
          : canNavigate && sourceId
          ? 'Click: ir al nodo ER'
          : undefined
      }
    >
      {value}
    </span>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

export const RelationalSchemaView: React.FC<RelationalSchemaViewProps> = ({
  schema,
  selectedNodeIds,
  onNavigateToNode,
  onRenameNode,
}) => {
  if (schema.tables.length === 0) {
    return (
      <div className="rs-empty">
        <span className="rs-empty-icon">📋</span>
        <p>El diagrama no tiene entidades todavía.</p>
        <p className="rs-empty-hint">Agregá entidades al modelo ER para ver el esquema relacional.</p>
      </div>
    );
  }

  return (
    <div className="rs-root">
      <div className="rs-grid">
        {schema.tables.map((table) => (
          <div key={table.name} className={`rs-card rs-card--${table.source}${selectedNodeIds?.has(table.sourceId) ? ' rs-card--selected' : ''}`}>
            <div className="rs-card-header">
              <EditableLabel
                value={table.name}
                sourceId={table.sourceId}
                canNavigate
                canEdit={table.source === 'entity' || table.source === 'relationship'}
                className="rs-table-name"
                onNavigate={onNavigateToNode}
                onRename={onRenameNode}
              />
              <span className={`rs-source-badge rs-source-badge--${table.source}`}>
                {SOURCE_LABEL[table.source]}
              </span>
            </div>
            <div className="rs-divider" />
            <ul className="rs-col-list">
              {table.columns
                .filter((c) => !c.isDerived)
                .map((col) => (
                  <li
                    key={col.name}
                    className={`rs-col ${col.isPrimaryKey ? 'rs-col--pk' : ''} ${col.isForeignKey ? 'rs-col--fk' : ''} ${col.isNullable ? 'rs-col--nullable' : ''}`}
                  >
                    <span className="rs-col-icon">
                      {col.isPrimaryKey ? '🔑' : col.isForeignKey ? '🔗' : '  '}
                    </span>
                    <EditableLabel
                      value={col.name}
                      sourceId={col.sourceId}
                      canNavigate={!!col.sourceId}
                      canEdit={!!col.sourceId}
                      className="rs-col-name"
                      onNavigate={onNavigateToNode}
                      onRename={onRenameNode}
                    />
                    {col.isPrimaryKey && <span className="rs-tag rs-tag--pk">PK</span>}
                    {col.isForeignKey && !col.isPrimaryKey && (
                      <span className="rs-tag rs-tag--fk">FK → {col.referencedTable}</span>
                    )}
                    {col.isPrimaryKey && col.isForeignKey && (
                      <span className="rs-tag rs-tag--fk">FK → {col.referencedTable}</span>
                    )}
                    {col.isNullable && !col.isPrimaryKey && (
                      <span className="rs-tag rs-tag--null">NULL</span>
                    )}
                  </li>
                ))}
            </ul>
            {table.primaryKey.length > 1 && (
              <div className="rs-pk-composite">
                PK compuesta: ({table.primaryKey.join(', ')})
              </div>
            )}
            {table.notes && table.notes.length > 0 && (
              <div className="rs-notes">
                {table.notes.map((note, i) => (
                  <span key={i} className="rs-note">
                    ℹ {note}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {schema.warnings.length > 0 && (
        <div className="rs-warnings">
          <span className="rs-warnings-title">⚠ Advertencias de modelado</span>
          <ul>
            {schema.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default RelationalSchemaView;

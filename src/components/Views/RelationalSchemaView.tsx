import React from 'react';
import './RelationalSchemaView.css';
import type { RelationalSchema, RelationalTable } from '../../utils/relationalSchema';

interface RelationalSchemaViewProps {
  schema: RelationalSchema;
}

const SOURCE_LABEL: Record<RelationalTable['source'], string> = {
  entity: 'Entidad',
  relationship: 'Relación',
  multivalued: 'Multivaluado',
  'isa-subtype': 'Subtipo ISA',
};

export const RelationalSchemaView: React.FC<RelationalSchemaViewProps> = ({ schema }) => {
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
          <div key={table.name} className={`rs-card rs-card--${table.source}`}>
            <div className="rs-card-header">
              <span className="rs-table-name">{table.name}</span>
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
                    <span className="rs-col-name">{col.name}</span>
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

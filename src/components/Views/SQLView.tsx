import React, { useState } from 'react';
import './SQLView.css';
import type { RelationalTable } from '../../utils/relationalSchema';

interface SQLViewProps {
  sql: string;
  tables?: RelationalTable[];
  onNavigateToNode?: (sourceId: string) => void;
}

export const SQLView: React.FC<SQLViewProps> = ({ sql, tables, onNavigateToNode }) => {
  const [copied, setCopied] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedSQL, setEditedSQL] = useState('');

  const handleCopy = () => {
    const content = editMode ? editedSQL : sql;
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const toggleEdit = () => {
    if (!editMode) setEditedSQL(sql);
    setEditMode((v) => !v);
  };

  const isEmpty = sql.trim() === '' || sql === '-- No hay tablas en el modelo.';

  if (isEmpty) {
    return (
      <div className="sql-empty">
        <span className="sql-empty-icon">🗄️</span>
        <p>El diagrama no tiene entidades todavía.</p>
        <p className="sql-empty-hint">Agregá entidades al modelo ER para generar el SQL DDL.</p>
      </div>
    );
  }

  // Build tableSourceId map: tableName → sourceId
  const tableSourceIds = new Map<string, string>();
  tables?.forEach((t) => tableSourceIds.set(t.name, t.sourceId));

  return (
    <div className="sql-root">
      <div className="sql-toolbar">
        <span className="sql-title">CREATE TABLE SQL</span>
        <div className="sql-toolbar-actions">
          <button
            className={`sql-edit-btn ${editMode ? 'sql-edit-btn--active' : ''}`}
            onClick={toggleEdit}
            title={editMode ? 'Volver al modo lectura (descarta cambios)' : 'Editar SQL manualmente'}
          >
            {editMode ? '✕ Cerrar editor' : '✎ Editar'}
          </button>
          <button
            className={`sql-copy-btn ${copied ? 'sql-copy-btn--done' : ''}`}
            onClick={handleCopy}
            title="Copiar SQL al portapapeles"
          >
            {copied ? '✓ Copiado' : '⎘ Copiar SQL'}
          </button>
        </div>
      </div>
      <div className="sql-scroll">
        {editMode ? (
          <textarea
            className="sql-textarea"
            value={editedSQL}
            onChange={(e) => setEditedSQL(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <pre
            className="sql-pre"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: highlightSQL(sql, tableSourceIds, onNavigateToNode) }}
          />
        )}
      </div>
    </div>
  );
};

// ─── Basic SQL syntax highlighter ────────────────────────────────────────────

const KEYWORDS = new Set([
  'CREATE', 'TABLE', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
  'NOT', 'NULL', 'ON', 'DELETE', 'CASCADE', 'SET', 'RESTRICT', 'INTEGER', 'VARCHAR',
]);

function highlightSQL(
  sql: string,
  tableSourceIds: Map<string, string>,
  onNavigate?: (sourceId: string) => void
): string {
  let expectTableName = false;

  return sql
    .split('\n')
    .map((line) => {
      if (line.startsWith('--')) {
        return `<span class="sql-comment">${escapeHtml(line)}</span>`;
      }

      return line.replace(/([A-Za-z_][A-Za-z0-9_]*|\(|\)|,|;|'[^']*'|\d+)/g, (token) => {
        const upper = token.toUpperCase();

        if (upper === 'TABLE') {
          expectTableName = true;
          return `<span class="sql-kw">${escapeHtml(token)}</span>`;
        }

        if (KEYWORDS.has(upper)) {
          return `<span class="sql-kw">${escapeHtml(token)}</span>`;
        }

        if (token === '(' || token === ')' || token === ',' || token === ';') {
          if (token === '(') expectTableName = false;
          return `<span class="sql-punc">${escapeHtml(token)}</span>`;
        }

        if (/^\d+$/.test(token)) {
          return `<span class="sql-num">${escapeHtml(token)}</span>`;
        }

        if (token.startsWith("'")) {
          return `<span class="sql-string">${escapeHtml(token)}</span>`;
        }

        // Table name after CREATE TABLE
        if (expectTableName) {
          expectTableName = false;
          const sourceId = tableSourceIds.get(token);
          if (sourceId && onNavigate) {
            const handler = `window.__derupNavigate('${sourceId}')`;
            return `<span class="sql-table-link sql-ident" onclick="${handler}" title="Click: ir al nodo ER">${escapeHtml(token)}</span>`;
          }
          return `<span class="sql-ident">${escapeHtml(token)}</span>`;
        }

        return `<span class="sql-ident">${escapeHtml(token)}</span>`;
      });
    })
    .join('\n');
}

// Register global navigate handler so inline onclick can reach React state
if (typeof window !== 'undefined') {
  (window as Window & { __derupNavigate?: (id: string) => void }).__derupNavigate = undefined;
}

// Hook to wire the global handler — called from App.tsx via a ref or effect
export function registerSQLNavigate(fn: (sourceId: string) => void) {
  (window as Window & { __derupNavigate?: (id: string) => void }).__derupNavigate = fn;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default SQLView;

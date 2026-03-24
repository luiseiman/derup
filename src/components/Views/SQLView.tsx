import React, { useState } from 'react';
import './SQLView.css';

interface SQLViewProps {
  sql: string;
}

export const SQLView: React.FC<SQLViewProps> = ({ sql }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(sql).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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

  // Syntax-highlight: tokenize the SQL into spans
  const highlighted = highlightSQL(sql);

  return (
    <div className="sql-root">
      <div className="sql-toolbar">
        <span className="sql-title">CREATE TABLE SQL</span>
        <button
          className={`sql-copy-btn ${copied ? 'sql-copy-btn--done' : ''}`}
          onClick={handleCopy}
          title="Copiar SQL al portapapeles"
        >
          {copied ? '✓ Copiado' : '⎘ Copiar SQL'}
        </button>
      </div>
      <div className="sql-scroll">
        <pre
          className="sql-pre"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </div>
    </div>
  );
};

// ─── Basic SQL syntax highlighter ────────────────────────────────────────────

const KEYWORDS = new Set([
  'CREATE', 'TABLE', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
  'NOT', 'NULL', 'ON', 'DELETE', 'CASCADE', 'SET', 'RESTRICT', 'INTEGER', 'VARCHAR',
]);

function highlightSQL(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      if (line.startsWith('--')) {
        return `<span class="sql-comment">${escapeHtml(line)}</span>`;
      }
      // Tokenize: words, parens, punctuation, strings
      return line.replace(/([A-Za-z_][A-Za-z0-9_]*|\(|\)|,|;|'[^']*'|\d+)/g, (token) => {
        if (KEYWORDS.has(token.toUpperCase())) {
          return `<span class="sql-kw">${escapeHtml(token)}</span>`;
        }
        if (token === '(' || token === ')' || token === ',' || token === ';') {
          return `<span class="sql-punc">${escapeHtml(token)}</span>`;
        }
        if (/^\d+$/.test(token)) {
          return `<span class="sql-num">${escapeHtml(token)}</span>`;
        }
        if (token.startsWith("'")) {
          return `<span class="sql-string">${escapeHtml(token)}</span>`;
        }
        return `<span class="sql-ident">${escapeHtml(token)}</span>`;
      });
    })
    .join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default SQLView;

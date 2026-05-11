import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RelationalTable } from '../../utils/relationalSchema';
import type { Relation } from '../../utils/relAlgebra/types';
import { RAError } from '../../utils/relAlgebra/types';
import { parse } from '../../utils/relAlgebra/parser';
import { evaluate } from '../../utils/relAlgebra/evaluator';
import { parseCSV, relationToCSV } from '../../utils/relAlgebra/csvLoader';
import { generateSampleRelation } from '../../utils/relAlgebra/sampleData';
import './AlgebraView.css';

interface AlgebraViewProps {
  tables: RelationalTable[];
}

const STORAGE_KEY = 'derup.algebra.v1';
const SYMBOLS: { sym: string; tip: string }[] = [
  { sym: 'σ', tip: 'select (selección)' },
  { sym: 'π', tip: 'project (proyección)' },
  { sym: 'ρ', tip: 'rename (renombrar)' },
  { sym: '⋈', tip: 'natural join' },
  { sym: '⨯', tip: 'producto cartesiano' },
  { sym: '∪', tip: 'unión' },
  { sym: '∩', tip: 'intersección' },
  { sym: '−', tip: 'diferencia' },
  { sym: '∧', tip: 'AND lógico' },
  { sym: '∨', tip: 'OR lógico' },
  { sym: '¬', tip: 'NOT lógico' },
  { sym: '≠', tip: 'distinto' },
  { sym: '≤', tip: 'menor o igual' },
  { sym: '≥', tip: 'mayor o igual' },
  { sym: '→', tip: 'flecha (rename de columna)' },
];

interface Persisted {
  query?: string;
  tablesData?: Record<string, SerializedRelation>;
}

interface SerializedRelation {
  columns: { name: string; type: string }[];
  rows: (string | number | boolean | null)[][];
}

function serializeRelation(rel: Relation): SerializedRelation {
  return {
    columns: rel.columns.map(c => ({ name: c.name, type: c.type })),
    rows: rel.rows.map(row =>
      row.map(v => {
        if (v instanceof Date) return v.toISOString();
        return v as string | number | boolean | null;
      })
    ),
  };
}

function deserializeRelation(s: SerializedRelation): Relation {
  return {
    columns: s.columns.map(c => ({ name: c.name, type: c.type as Relation['columns'][0]['type'] })),
    rows: s.rows.map(row =>
      row.map((v, ci) => {
        const t = s.columns[ci].type;
        if (v === null) return null;
        if (t === 'date' && typeof v === 'string') return new Date(v);
        return v;
      })
    ),
  };
}

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Persisted;
  } catch { return {}; }
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

const AlgebraView: React.FC<AlgebraViewProps> = ({ tables }) => {
  const persisted = useMemo(loadPersisted, []);

  const [query, setQuery] = useState(
    persisted.query ?? '# Escribí tu consulta en álgebra relacional acá.\n# Ejemplo:\n# π_{nombre, email} (σ_{estado = \'activo\'} (usuario))\n'
  );

  const [tablesData, setTablesData] = useState<Map<string, Relation>>(() => {
    const m = new Map<string, Relation>();
    if (persisted.tablesData) {
      for (const [name, s] of Object.entries(persisted.tablesData)) {
        m.set(name, deserializeRelation(s));
      }
    }
    return m;
  });

  const [derived, setDerived] = useState<Map<string, Relation>>(new Map());
  const [result, setResult] = useState<Relation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorPos, setErrorPos] = useState<{ line: number; column: number } | null>(null);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingTargetTable = useRef<string | null>(null);

  // ---- persistence (debounced) ----
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const tablesSerialized: Record<string, SerializedRelation> = {};
        tablesData.forEach((rel, name) => { tablesSerialized[name] = serializeRelation(rel); });
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ query, tablesData: tablesSerialized } satisfies Persisted));
      } catch {
        // storage full — ignore
      }
    }, 400);
    return () => clearTimeout(t);
  }, [query, tablesData]);

  // ---- actions ----

  const runQuery = useCallback(() => {
    setError(null);
    setErrorPos(null);
    try {
      const program = parse(query);
      // Build env: base tables + previously derived (overwritten by fresh assignments)
      const env = new Map<string, Relation>();
      tablesData.forEach((rel, name) => env.set(name, rel));
      const { result: r, derived: d } = evaluate(program, env);
      setDerived(d);
      setResult(r);
    } catch (e) {
      if (e instanceof RAError) {
        setError(e.message);
        if (e.pos) setErrorPos({ line: e.pos.line, column: e.pos.column });
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      setResult(null);
    }
  }, [query, tablesData]);

  const insertSymbol = (sym: string) => {
    const ta = editorRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = query.slice(0, start) + sym + query.slice(end);
    setQuery(next);
    // restore caret after the inserted symbol
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + sym.length;
    });
  };

  const triggerLoadCSV = (tableName: string) => {
    pendingTargetTable.current = tableName;
    fileInputRef.current?.click();
  };

  const handleCSVFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const targetTable = pendingTargetTable.current;
    if (!targetTable) return;
    try {
      const text = await f.text();
      const rel = parseCSV(text);
      setTablesData(prev => {
        const next = new Map(prev);
        next.set(targetTable, rel);
        return next;
      });
    } catch (err) {
      alert(`Error al cargar CSV: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const generateDummy = (table: RelationalTable) => {
    const rel = generateSampleRelation(table, 10);
    setTablesData(prev => {
      const next = new Map(prev);
      next.set(table.name, rel);
      return next;
    });
  };

  const clearTableData = (name: string) => {
    setTablesData(prev => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
  };

  const exportResultCSV = () => {
    if (!result) return;
    const csv = relationToCSV(result);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resultado-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearEditor = () => {
    setQuery('');
    setResult(null);
    setError(null);
    setErrorPos(null);
    setDerived(new Map());
  };

  // ---- derived helpers ----

  const allRelations = useMemo(() => {
    const names = new Set<string>();
    tables.forEach(t => names.add(t.name));
    return Array.from(names).sort();
  }, [tables]);

  // ---- render ----

  return (
    <div className="algebra-view">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: 'none' }}
        onChange={handleCSVFile}
      />

      <div className="algebra-toolbar">
        <h3>Álgebra relacional</h3>
        <div className="algebra-toolbar-actions">
          <button className="algebra-btn primary" onClick={runQuery}>▶ Ejecutar</button>
          <button className="algebra-btn" onClick={clearEditor}>Limpiar</button>
          <button className="algebra-btn" onClick={exportResultCSV} disabled={!result}>
            Exportar CSV
          </button>
        </div>
      </div>

      <div className="algebra-body">
        {/* ===== LEFT: Tables ===== */}
        <div className="algebra-panel">
          <div className="algebra-panel-header">
            <span>Tablas del esquema ({tables.length})</span>
          </div>
          <div className="algebra-panel-body">
            {tables.length === 0 && (
              <div className="ra-empty">
                <div>Sin tablas en el esquema.</div>
                <div style={{ fontSize: '0.75rem' }}>Definí entidades en la pestaña ER.</div>
              </div>
            )}
            {tables.map(t => {
              const loaded = tablesData.get(t.name);
              const isExpanded = expandedTable === t.name;
              return (
                <div key={t.sourceId + ':' + t.name} className="ra-table-item">
                  <div
                    className="ra-table-header"
                    onClick={() => setExpandedTable(isExpanded ? null : t.name)}
                  >
                    <span>{t.name}</span>
                    <span className={`ra-row-count ${loaded ? 'loaded' : ''}`}>
                      {loaded ? `${loaded.rows.length} filas` : 'sin datos'}
                    </span>
                  </div>
                  {isExpanded && (
                    <>
                      <div className="ra-table-cols">
                        {t.columns.filter(c => !c.isDerived).map(c => (
                          <div key={c.name}>
                            {c.isPrimaryKey ? '🔑' : c.isForeignKey ? '🔗' : '•'} {c.name}
                            {loaded && (
                              <span className="ra-col-type">
                                : {loaded.columns.find(lc => lc.name === c.name)?.type ?? '—'}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="ra-table-actions">
                        <button className="algebra-btn" onClick={() => triggerLoadCSV(t.name)}>
                          Cargar CSV
                        </button>
                        <button className="algebra-btn" onClick={() => generateDummy(t)}>
                          Datos demo
                        </button>
                        {loaded && (
                          <button className="algebra-btn danger" onClick={() => clearTableData(t.name)}>
                            Vaciar
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {derived.size > 0 && (
              <>
                <div className="ra-section-label">Relaciones derivadas (:=)</div>
                {Array.from(derived.entries()).map(([name, rel]) => (
                  <div key={name} className="ra-derived-item">
                    <span>
                      <span className="ra-derived-name">{name}</span>
                      <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>
                        ({rel.rows.length} filas)
                      </span>
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* ===== CENTER: Editor ===== */}
        <div className="algebra-panel">
          <div className="algebra-panel-header">
            <span>Consulta</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Unicode o ASCII · Ctrl+Enter para ejecutar
            </span>
          </div>
          <textarea
            ref={editorRef}
            className="ra-editor"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                runQuery();
              }
            }}
            spellCheck={false}
          />
          <div className="ra-symbols-bar">
            {SYMBOLS.map(s => (
              <button
                key={s.sym}
                className="ra-symbol-btn"
                title={s.tip}
                onClick={() => insertSymbol(s.sym)}
              >
                {s.sym}
              </button>
            ))}
          </div>
        </div>

        {/* ===== RIGHT: Result ===== */}
        <div className="algebra-panel">
          <div className="algebra-panel-header">
            <span>Resultado</span>
            {result && <span>{result.rows.length} filas · {result.columns.length} columnas</span>}
          </div>
          <div className="algebra-panel-body">
            {error && (
              <div className="ra-error">
                {error}
                {errorPos && <div style={{ marginTop: 4, fontSize: '0.75rem' }}>
                  Línea {errorPos.line}, columna {errorPos.column}
                </div>}
              </div>
            )}
            {!error && !result && (
              <div className="ra-empty">
                <div style={{ fontSize: '2rem' }}>π σ ⋈</div>
                <div>Escribí una consulta y presioná Ejecutar.</div>
                <div style={{ fontSize: '0.72rem', marginTop: 8, textAlign: 'center', maxWidth: 320 }}>
                  Las tablas con datos cargados aparecen en verde a la izquierda.
                  Podés cargar CSVs propios o generar datos demo.
                </div>
              </div>
            )}
            {!error && result && (
              <table className="ra-result-table">
                <thead>
                  <tr>
                    {result.columns.map(c => (
                      <th key={c.name}>
                        {c.name}
                        <span className="ra-col-type-tag">{c.type}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((v, ci) => (
                        <td key={ci}>{formatValue(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Hint about available relations — non-blocking */}
      {allRelations.length > 0 && (
        <div style={{
          padding: '4px 12px',
          fontSize: '0.72rem',
          color: 'var(--text-muted)',
          borderTop: '1px solid var(--panel-border)',
          background: 'rgba(255,255,255,0.6)',
        }}>
          Relaciones disponibles: {allRelations.join(', ')}
          {derived.size > 0 && ' · derivadas: ' + Array.from(derived.keys()).join(', ')}
        </div>
      )}
    </div>
  );
};

export default AlgebraView;

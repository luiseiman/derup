import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RelationalTable } from '../../utils/relationalSchema';
import type { ColumnType, Relation, Value } from '../../utils/relAlgebra/types';
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
  { sym: '.', tip: 'punto (calificador R.col)' },
];

interface Persisted {
  query?: string;
  tablesData?: Record<string, SerializedRelation>;
  importedRelations?: Record<string, SerializedRelation>;
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

  const [importedRelations, setImportedRelations] = useState<Map<string, Relation>>(() => {
    const m = new Map<string, Relation>();
    if (persisted.importedRelations) {
      for (const [name, s] of Object.entries(persisted.importedRelations)) {
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

  // CRUD modal state — name of the relation being edited and a working copy.
  const [editingRelation, setEditingRelation] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState<Relation | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const pendingTargetTable = useRef<string | null>(null);

  // ---- persistence (debounced) ----
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const tablesSerialized: Record<string, SerializedRelation> = {};
        tablesData.forEach((rel, name) => { tablesSerialized[name] = serializeRelation(rel); });
        const importedSerialized: Record<string, SerializedRelation> = {};
        importedRelations.forEach((rel, name) => { importedSerialized[name] = serializeRelation(rel); });
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          query,
          tablesData: tablesSerialized,
          importedRelations: importedSerialized,
        } satisfies Persisted));
      } catch {
        // storage full — ignore
      }
    }, 400);
    return () => clearTimeout(t);
  }, [query, tablesData, importedRelations]);

  // ---- actions ----

  const runQuery = useCallback(() => {
    setError(null);
    setErrorPos(null);
    try {
      const program = parse(query);
      // Build env: schema tables + imported relations + previously derived.
      // If an imported relation shares a name with a schema table, imported wins.
      const env = new Map<string, Relation>();
      tablesData.forEach((rel, name) => env.set(name, rel));
      importedRelations.forEach((rel, name) => env.set(name, rel));
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
  }, [query, tablesData, importedRelations]);

  /** Insert arbitrary text at the current caret position in the query editor.
   *  Used by the symbols bar AND by click-to-insert on relations and columns. */
  const insertAtCaret = useCallback((text: string) => {
    const ta = editorRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setQuery(prev => prev.slice(0, start) + text + prev.slice(end));
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + text.length;
    });
  }, []);

  const insertSymbol = (sym: string) => insertAtCaret(sym);

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

  // ---- ad-hoc CSV import (relations not tied to ER schema) ----

  /** Sanitize a filename into a valid identifier: letters, digits, underscore;
   *  starts with letter or underscore. Returns null if nothing usable. */
  const sanitizeRelName = (raw: string): string | null => {
    let s = raw
      .replace(/\.[^.]+$/, '')           // strip extension
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')    // strip accents
      .replace(/[^a-zA-Z0-9_]/g, '_')     // non-alnum → _
      .replace(/_+/g, '_')                // collapse repeats
      .replace(/^_|_$/g, '');             // trim edges
    if (s === '') return null;
    if (/^[0-9]/.test(s)) s = '_' + s;    // can't start with digit
    return s;
  };

  /** Find a free name by appending _2, _3, … when there's a collision with
   *  schema tables or already-imported relations. */
  const uniqueRelName = (base: string, exclude?: string): string => {
    const taken = new Set<string>();
    tables.forEach(t => taken.add(t.name));
    importedRelations.forEach((_, n) => taken.add(n));
    if (exclude) taken.delete(exclude);
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
  };

  const triggerImportCSV = () => importInputRef.current?.click();

  const handleImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    const errors: string[] = [];
    const added: Map<string, Relation> = new Map();
    for (const f of files) {
      try {
        const text = await f.text();
        const rel = parseCSV(text);
        const base = sanitizeRelName(f.name) ?? `relacion_${importedRelations.size + added.size + 1}`;
        const name = uniqueRelName(base);
        added.set(name, rel);
      } catch (err) {
        errors.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (added.size > 0) {
      setImportedRelations(prev => {
        const next = new Map(prev);
        added.forEach((rel, name) => next.set(name, rel));
        return next;
      });
    }
    if (errors.length > 0) {
      alert(`Algunos archivos no se pudieron importar:\n\n${errors.join('\n')}`);
    }
  };

  const renameImported = (oldName: string) => {
    const proposed = prompt(`Nuevo nombre para la relación "${oldName}":`, oldName);
    if (!proposed || proposed === oldName) return;
    const sanitized = sanitizeRelName(proposed);
    if (!sanitized) { alert('Nombre inválido. Usá letras, dígitos y _ (sin empezar con dígito).'); return; }
    const finalName = uniqueRelName(sanitized, oldName);
    setImportedRelations(prev => {
      const next = new Map<string, Relation>();
      prev.forEach((rel, n) => {
        if (n === oldName) next.set(finalName, rel);
        else next.set(n, rel);
      });
      return next;
    });
  };

  const removeImported = (name: string) => {
    if (!confirm(`¿Quitar la relación "${name}"?`)) return;
    setImportedRelations(prev => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
  };

  // ---- CRUD modal (alta/edición/baja de filas) ----

  /** Open the row editor for a relation. Falls back to creating an empty
   *  relation seeded from the schema (column names + inferred types) when
   *  the table has no data yet. */
  const openEditor = (name: string) => {
    let rel = importedRelations.get(name) ?? tablesData.get(name);
    if (!rel) {
      const t = tables.find(t => t.name === name);
      if (!t) return;
      // Build empty relation from schema columns; types inferred at save time.
      rel = {
        columns: t.columns
          .filter(c => !c.isDerived)
          .map(c => ({ name: c.name, type: 'string' as ColumnType })),
        rows: [],
      };
    }
    setEditBuffer({
      columns: rel.columns.map(c => ({ ...c })),
      rows: rel.rows.map(r => [...r]),
    });
    setEditingRelation(name);
  };

  const closeEditor = (save: boolean) => {
    if (save && editingRelation && editBuffer) {
      const buf: Relation = {
        columns: editBuffer.columns.map(c => ({ ...c })),
        rows: editBuffer.rows.map(r => [...r]),
      };
      if (importedRelations.has(editingRelation)) {
        setImportedRelations(prev => { const n = new Map(prev); n.set(editingRelation, buf); return n; });
      } else {
        // Schema table data (whether previously loaded or seeded empty)
        setTablesData(prev => { const n = new Map(prev); n.set(editingRelation, buf); return n; });
      }
    }
    setEditingRelation(null);
    setEditBuffer(null);
  };

  /** Parse a raw string into the target column type. Returns the raw string
   *  unchanged when it can't be parsed (UI will flag it as invalid via CSS). */
  const parseCell = (raw: string, type: ColumnType): Value => {
    if (raw === '') return null;
    if (type === 'number') {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    if (type === 'date') {
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? raw : d;
    }
    if (type === 'boolean') {
      const v = raw.trim().toLowerCase();
      if (v === 'true') return true;
      if (v === 'false') return false;
      return raw;
    }
    return raw;
  };

  /** Used by the inline grid to render the current cell value as text. */
  const cellToText = (v: Value): string => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v);
  };

  /** Whether the current cell value is consistent with its column type. */
  const cellIsValid = (v: Value, type: ColumnType): boolean => {
    if (v === null) return true;
    if (type === 'number') return typeof v === 'number';
    if (type === 'date') return v instanceof Date;
    if (type === 'boolean') return typeof v === 'boolean';
    return true;
  };

  const updateCell = (ri: number, ci: number, raw: string) => {
    setEditBuffer(prev => {
      if (!prev) return prev;
      const newVal = parseCell(raw, prev.columns[ci].type);
      const newRows = prev.rows.map((r, i) =>
        i === ri ? r.map((c, j) => (j === ci ? newVal : c)) : r
      );
      return { ...prev, rows: newRows };
    });
  };

  const addRow = () => {
    setEditBuffer(prev => prev ? {
      ...prev,
      rows: [...prev.rows, prev.columns.map(() => null as Value)],
    } : prev);
  };

  const deleteRow = (ri: number) => {
    setEditBuffer(prev => prev ? {
      ...prev,
      rows: prev.rows.filter((_, i) => i !== ri),
    } : prev);
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
    importedRelations.forEach((_, n) => names.add(n));
    return Array.from(names).sort();
  }, [tables, importedRelations]);

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
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,text/csv"
        multiple
        style={{ display: 'none' }}
        onChange={handleImportFiles}
      />

      <div className="algebra-toolbar">
        <h3>Álgebra relacional</h3>
        <div className="algebra-toolbar-actions">
          <button className="algebra-btn" onClick={triggerImportCSV} title="Importar uno o varios CSV como relaciones nuevas (sin necesidad de ER)">
            📥 Importar CSV
          </button>
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
            {tables.length === 0 && importedRelations.size === 0 && (
              <div className="ra-empty">
                <div>No hay relaciones disponibles.</div>
                <div style={{ fontSize: '0.75rem', textAlign: 'center', maxWidth: 240 }}>
                  Importá uno o varios CSV con el botón "📥 Importar CSV"
                  o definí entidades en la pestaña ER.
                </div>
              </div>
            )}
            {tables.map(t => {
              const loaded = tablesData.get(t.name);
              const isExpanded = expandedTable === t.name;
              return (
                <div key={t.sourceId + ':' + t.name} className="ra-table-item">
                  <div className="ra-table-header">
                    <span
                      className="ra-name-click"
                      title="Insertar el nombre en la consulta"
                      onClick={(e) => { e.stopPropagation(); insertAtCaret(t.name); }}
                    >{t.name}</span>
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span className={`ra-row-count ${loaded ? 'loaded' : ''}`}>
                        {loaded ? `${loaded.rows.length} filas` : 'sin datos'}
                      </span>
                      <button
                        className="ra-chevron"
                        onClick={() => setExpandedTable(isExpanded ? null : t.name)}
                        title={isExpanded ? 'Contraer' : 'Expandir'}
                      >{isExpanded ? '▾' : '▸'}</button>
                    </span>
                  </div>
                  {isExpanded && (
                    <>
                      <div className="ra-table-cols">
                        {t.columns.filter(c => !c.isDerived).map(c => (
                          <div
                            key={c.name}
                            className="ra-col-click"
                            title="Insertar columna en la consulta"
                            onClick={() => insertAtCaret(c.name)}
                          >
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
                        <button className="algebra-btn" onClick={() => openEditor(t.name)}>
                          Editar datos
                        </button>
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

            {importedRelations.size > 0 && (
              <>
                <div className="ra-section-label">Relaciones importadas ({importedRelations.size})</div>
                {Array.from(importedRelations.entries()).map(([name, rel]) => {
                  const isExpanded = expandedTable === '__imp__' + name;
                  return (
                    <div key={'imp:' + name} className="ra-table-item">
                      <div className="ra-table-header" style={{ background: '#ecfdf5' }}>
                        <span
                          className="ra-name-click"
                          title="Insertar el nombre en la consulta"
                          onClick={(e) => { e.stopPropagation(); insertAtCaret(name); }}
                        >{name}</span>
                        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span className="ra-row-count loaded">{rel.rows.length} filas</span>
                          <button
                            className="ra-chevron"
                            onClick={() => setExpandedTable(isExpanded ? null : '__imp__' + name)}
                            title={isExpanded ? 'Contraer' : 'Expandir'}
                          >{isExpanded ? '▾' : '▸'}</button>
                        </span>
                      </div>
                      {isExpanded && (
                        <>
                          <div className="ra-table-cols">
                            {rel.columns.map(c => (
                              <div
                                key={c.name}
                                className="ra-col-click"
                                title="Insertar columna en la consulta"
                                onClick={() => insertAtCaret(c.name)}
                              >
                                • {c.name}<span className="ra-col-type">: {c.type}</span>
                              </div>
                            ))}
                          </div>
                          <div className="ra-table-actions">
                            <button className="algebra-btn" onClick={() => openEditor(name)}>
                              Editar datos
                            </button>
                            <button className="algebra-btn" onClick={() => renameImported(name)}>
                              Renombrar
                            </button>
                            <button className="algebra-btn danger" onClick={() => removeImported(name)}>
                              Quitar
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </>
            )}

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

      {/* ===== CRUD MODAL ===== */}
      {editingRelation && editBuffer && (
        <div className="ra-modal-overlay" onClick={() => closeEditor(false)}>
          <div className="ra-modal" onClick={e => e.stopPropagation()}>
            <div className="ra-modal-header">
              <span>
                Editar datos de <code>{editingRelation}</code>
                <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                  {editBuffer.rows.length} fila{editBuffer.rows.length !== 1 ? 's' : ''}
                </span>
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="algebra-btn" onClick={() => closeEditor(false)}>Cancelar</button>
                <button className="algebra-btn primary" onClick={() => closeEditor(true)}>
                  Guardar
                </button>
              </div>
            </div>
            <div className="ra-modal-body">
              <table className="ra-edit-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    {editBuffer.columns.map(c => (
                      <th key={c.name}>
                        {c.name}
                        <span className="ra-col-type-tag">{c.type}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {editBuffer.rows.map((row, ri) => (
                    <tr key={ri}>
                      <td>
                        <button
                          className="ra-row-del"
                          onClick={() => deleteRow(ri)}
                          title="Eliminar fila"
                        >×</button>
                      </td>
                      {row.map((v, ci) => {
                        const type = editBuffer.columns[ci].type;
                        const valid = cellIsValid(v, type);
                        return (
                          <td key={ci}>
                            {type === 'boolean' ? (
                              <select
                                value={v === null || v === undefined ? '' : String(v)}
                                onChange={e => updateCell(ri, ci, e.target.value)}
                              >
                                <option value="">(vacío)</option>
                                <option value="true">true</option>
                                <option value="false">false</option>
                              </select>
                            ) : (
                              <input
                                className={valid ? '' : 'invalid'}
                                value={cellToText(v)}
                                type={type === 'number' ? 'text' : type === 'date' ? 'date' : 'text'}
                                onChange={e => updateCell(ri, ci, e.target.value)}
                                placeholder={type === 'date' ? 'YYYY-MM-DD' : ''}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {editBuffer.rows.length === 0 && (
                    <tr><td colSpan={editBuffer.columns.length + 1} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
                      Sin filas. Hacé clic en "+ Agregar fila" para empezar.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="ra-modal-footer">
              <button className="algebra-btn" onClick={addRow}>+ Agregar fila</button>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Las celdas en rojo no se corresponden con el tipo de la columna.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AlgebraView;

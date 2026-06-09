import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RelationalTable } from '../../utils/relationalSchema';
import type { ColumnType, Program, RelExpr, Relation, Value } from '../../utils/relAlgebra/types';
import { RAError } from '../../utils/relAlgebra/types';
import { parse } from '../../utils/relAlgebra/parser';
import { evaluate } from '../../utils/relAlgebra/evaluator';
import { parseCSV, relationToCSV } from '../../utils/relAlgebra/csvLoader';
import { generateSampleRelation } from '../../utils/relAlgebra/sampleData';
import AlgebraPreview from './AlgebraPreview';
import AlgebraTree from './AlgebraTree';
import { highlight as highlightQuery } from './algebraHighlight';
import SqlEditor from './SqlEditor';
import { predictNext, wordAtCaret, type Suggestion as PredictSuggestion } from './algebraPredict';
import { reverseEngineerER } from '../../utils/reverseEngineerER';
import { sqlToAlgebra } from '../../utils/sqlToAlgebra';
import { initSqlEngine } from '../../utils/sqlEngine';
import Splitter from '../Splitter';
import { useSettings } from '../../hooks/useSettings';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import './AlgebraView.css';

interface AlgebraViewProps {
  tables: RelationalTable[];
  /** Optional callback: when invoked, the parent should replace its current
   *  ER nodes/connections with the supplied ones and ideally switch to the ER
   *  tab so the user sees the result. Wired in App.tsx. */
  onApplyReverseEngineeredER?: (nodes: import('../../types/er').ERNode[], connections: import('../../types/er').Connection[], notes: string[]) => void;
  /** Query+run command pushed from the chat (algebra-query AI response).
   *  Bumped via `at` each time, so the same query can be applied repeatedly. */
  pendingQuery?: { query: string; run: boolean; at: number } | null;
  /** Called after AlgebraView has applied the pending query, so the parent
   *  can clear the prop. */
  onPendingQueryConsumed?: () => void;
  /** Pending ABM (data manipulation) command from the chat. Already
   *  user-confirmed by the parent. */
  pendingDataChange?: {
    action: 'append' | 'replace' | 'update-row' | 'delete-rows' | 'create-relation';
    relation: string;
    columns?: { name: string; type: 'number' | 'string' | 'date' | 'boolean' }[];
    rows?: (string | number | boolean | null)[][];
    rowIndex?: number;
    values?: Record<string, string | number | boolean | null>;
    rowIndices?: number[];
    at: number;
  } | null;
  /** Called once the change is applied. */
  onPendingDataConsumed?: () => void;
}

const STORAGE_KEY = 'derup.algebra.v1';

/**
 * Each symbol declares whether it wants automatic padding around it when
 * inserted via click. Unary prefix operators (σ π ρ ¬) pad before only —
 * a trailing space would look weird in "σ_{...}". Binary operators and
 * comparators pad on both sides. Punctuation like "." pads nothing.
 */
type InsertKind = 'name' | 'unary' | 'binary' | 'punct';
const SYMBOLS: { sym: string; tip: string; kind: InsertKind; shortcut?: string }[] = [
  { sym: 'σ', tip: 'selección',           kind: 'unary',  shortcut: 'S' },
  { sym: 'π', tip: 'proyección',          kind: 'unary',  shortcut: 'P' },
  { sym: 'ρ', tip: 'renombrar',           kind: 'unary',  shortcut: 'R' },
  { sym: '⋈', tip: 'junta natural',       kind: 'binary', shortcut: 'J' },
  { sym: '⨯', tip: 'producto cartesiano', kind: 'binary', shortcut: 'X' },
  { sym: '÷', tip: 'división',            kind: 'binary', shortcut: 'D' },
  { sym: '∪', tip: 'unión',               kind: 'binary', shortcut: 'U' },
  { sym: '∩', tip: 'intersección',        kind: 'binary', shortcut: 'I' },
  { sym: '−', tip: 'diferencia',          kind: 'binary', shortcut: 'M' },
  { sym: '∧', tip: 'AND lógico',          kind: 'binary', shortcut: 'A' },
  { sym: '∨', tip: 'OR lógico',           kind: 'binary', shortcut: 'O' },
  { sym: '¬', tip: 'NOT lógico',          kind: 'unary',  shortcut: 'N' },
  { sym: '≠', tip: 'distinto',            kind: 'binary', shortcut: '=' },
  { sym: '≤', tip: 'menor o igual',       kind: 'binary', shortcut: ',' },
  { sym: '≥', tip: 'mayor o igual',       kind: 'binary', shortcut: '.' },
  { sym: '→', tip: 'flecha (rename de columna)', kind: 'binary', shortcut: '>' },
  { sym: '.', tip: 'calificador R.col',   kind: 'punct' },
];

/** Quick lookup: keyboard key (lowercase) → unicode symbol to insert. Built
 *  from SYMBOLS so the two never drift apart. */
const KEY_TO_SYMBOL: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const s of SYMBOLS) {
    if (s.shortcut) map[s.shortcut.toLowerCase()] = s.sym;
  }
  return map;
})();

/** Detect Mac for tooltip display (⌥) vs Windows/Linux (Alt). */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const ALT_LABEL = IS_MAC ? '⌥' : 'Alt+';

interface Persisted {
  query?: string;
  /** Buffer for the non-active mode when `editorMode` is 'algebra'.
   *  Holds the SQL text the user had typed last in the SQL tab. */
  sqlQuery?: string;
  /** Active tab: 'algebra' (relational algebra) or 'sql' (translated to RA). */
  editorMode?: 'algebra' | 'sql';
  tablesData?: Record<string, SerializedRelation>;
  importedRelations?: Record<string, SerializedRelation>;
}

const DEFAULT_ALGEBRA_QUERY = '# Escribí tu consulta en álgebra relacional acá.\n# Ejemplo:\n# π_{nombre, email} (σ_{estado = \'activo\'} (usuario))\n';
const DEFAULT_SQL_QUERY = '-- Escribí tu consulta SQL acá.\n-- Soporta: SELECT, FROM, WHERE, JOIN, CROSS JOIN, NATURAL JOIN.\n-- Ejemplo:\n-- SELECT nombre, email FROM usuario WHERE estado = \'activo\';\n';

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

const AlgebraView: React.FC<AlgebraViewProps> = ({
  tables, onApplyReverseEngineeredER,
  pendingQuery, onPendingQueryConsumed,
  pendingDataChange, onPendingDataConsumed,
}) => {
  const persisted = useMemo(loadPersisted, []);
  const { settings: appSettings, setShowResultTree, setShowResultData } = useSettings();
  const showTables = appSettings.panels.algebraTables;
  const showResult = appSettings.panels.algebraResult;
  const showResultTree = appSettings.showResultTree;
  const showResultData = appSettings.showResultData;
  const resultLayout = appSettings.resultLayout;

  // Two editors share the same evaluation pipeline but keep their own text
  // buffer. `query` is always the active mode's text — `sqlQuery` mirrors
  // whatever the user typed in the SQL tab. Swapping tabs just swaps which
  // string is the "active" one. We keep this split rather than a single
  // `bufferedQuery` because we want both buffers to be persisted independently.
  const [editorMode, setEditorMode] = useState<'algebra' | 'sql'>(persisted.editorMode ?? 'algebra');
  const [query, setQuery] = useState(
    (persisted.editorMode === 'sql' ? persisted.sqlQuery : persisted.query)
    ?? (persisted.editorMode === 'sql' ? DEFAULT_SQL_QUERY : DEFAULT_ALGEBRA_QUERY)
  );
  // Inactive-mode buffer. When the active mode is 'algebra', this holds the
  // SQL text; when active is 'sql', this holds the algebra text.
  const [bufferedQuery, setBufferedQuery] = useState<string>(() => {
    if (persisted.editorMode === 'sql') return persisted.query ?? DEFAULT_ALGEBRA_QUERY;
    return persisted.sqlQuery ?? DEFAULT_SQL_QUERY;
  });

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

  // Last successful execution — kept for tree visualization and intermediate-result drill-down.
  const [lastProgram, setLastProgram] = useState<Program | null>(null);
  const [lastTrace, setLastTrace] = useState<Map<RelExpr, Relation>>(new Map());
  const [selectedTreeNode, setSelectedTreeNode] = useState<RelExpr | null>(null);
  const [queryMs, setQueryMs] = useState<number | null>(null);
  /** True while runQuery's awaiting an async dependency (currently: sql.js
   *  WASM boot on the first SQL run, ~200-500 ms cold). Used to disable the
   *  ▶ Ejecutar button so the user doesn't fire multiple requests. */
  const [isExecuting, setIsExecuting] = useState(false);

  // ----- Autocomplete state -----
  const [caretPos, setCaretPos] = useState(0);
  const [acVisible, setAcVisible] = useState(true);
  const [acIndex, setAcIndex] = useState(0);

  // Column widths for the 3-panel layout (tables | consulta | resultado).
  // The third panel takes remaining space (1fr). Persisted so the user's
  // tweak survives a reload.
  const [tablesPanelWidth, setTablesPanelWidth] = useLocalStorage<number>('derup.algebra.col1', 280);
  const [editorPanelWidth, setEditorPanelWidth] = useLocalStorage<number>('derup.algebra.col2', 460);
  /** Height of the result panel when it sits BELOW the editor.
   *  Drag the horizontal splitter to resize. Stored separately from the
   *  side-layout widths so switching layouts preserves both preferences. */
  const [resultPanelHeight, setResultPanelHeight] = useLocalStorage<number>('derup.algebra.resultH', 280);
  const tablesDragBaseline = useRef(tablesPanelWidth);
  const editorDragBaseline = useRef(editorPanelWidth);
  const resultHeightDragBaseline = useRef(resultPanelHeight);

  // CRUD modal state — name of the relation being edited and a working copy.
  const [editingRelation, setEditingRelation] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState<Relation | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
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
        // Map the dual buffer back to {query, sqlQuery} where `query` always
        // means the algebra buffer (back-compat with older persisted state).
        const algebraBuf = editorMode === 'algebra' ? query : bufferedQuery;
        const sqlBuf     = editorMode === 'sql'     ? query : bufferedQuery;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          query: algebraBuf,
          sqlQuery: sqlBuf,
          editorMode,
          tablesData: tablesSerialized,
          importedRelations: importedSerialized,
        } satisfies Persisted));
      } catch {
        // storage full — ignore
      }
    }, 400);
    return () => clearTimeout(t);
  }, [query, bufferedQuery, editorMode, tablesData, importedRelations]);

  // ---- actions ----

  /** Pre-flight check before running the algebra parser: if the user typed
   *  a SELECT … FROM … statement (SQL) we translate it into the equivalent
   *  algebra expression so they don't have to leave the editor to rewrite. */
  const [sqlTranslationNote, setSqlTranslationNote] = useState<string | null>(null);

  const runQuery = useCallback(async () => {
    setError(null);
    setErrorPos(null);
    setSqlTranslationNote(null);

    // Build the environment once — both code paths need it.
    const env = new Map<string, Relation>();
    tablesData.forEach((rel, name) => env.set(name, rel));
    importedRelations.forEach((rel, name) => env.set(name, rel));

    // ── SQL mode ────────────────────────────────────────────────────────
    // We embed SQLite (sql.js) so the user gets a real SQL engine: SELECT,
    // JOINs, subqueries, CTEs, window functions, UNION, INSERT/UPDATE/DELETE,
    // DDL, the lot. No more hand-written subset — see commit history.
    //
    // sqlToAlgebra is kept ONLY as an optional didactic hint: if the query
    // happens to be plain SELECT/WHERE/JOIN that we know how to translate,
    // we show the equivalent algebra expression next to the result.
    if (editorMode === 'sql') {
      const stripped = query
        .split('\n')
        .map(line => line.replace(/--.*$/, ''))
        .join('\n')
        .trim();
      if (!stripped) {
        setError('Escribí una consulta SQL para ejecutar.');
        return;
      }
      setIsExecuting(true);
      try {
        const engine = await initSqlEngine();
        const { result: r, ms, rowsAffected } = engine.execute(stripped, env);
        setDerived(new Map());
        setResult(r);
        setLastProgram(null); // SQL doesn't produce an algebra tree
        setLastTrace(new Map());
        setSelectedTreeNode(null);
        setQueryMs(ms);

        // Optional algebra translation as a didactic note (only if the
        // query happens to be inside the algebra-translatable subset).
        const trans = sqlToAlgebra(stripped);
        if (trans) {
          setSqlTranslationNote(trans.note);
        } else if (rowsAffected !== null) {
          setSqlTranslationNote(`SQL ejecutado: ${rowsAffected} fila${rowsAffected !== 1 ? 's' : ''} afectada${rowsAffected !== 1 ? 's' : ''}.`);
        }
      } catch (e) {
        // sql.js throws Error with the SQLite message verbatim (usually
        // something like "near \"foo\": syntax error").
        setError(`SQL: ${e instanceof Error ? e.message : String(e)}`);
        setResult(null);
        setLastProgram(null);
        setLastTrace(new Map());
        setSelectedTreeNode(null);
        setQueryMs(null);
      } finally {
        setIsExecuting(false);
      }
      return;
    }

    // ── Algebra mode — run the user's text verbatim ─────────────────────
    try {
      const program = parse(query);
      const t0 = performance.now();
      const { result: r, derived: d, trace } = evaluate(program, env);
      const t1 = performance.now();
      setDerived(d);
      setResult(r);
      setLastProgram(program);
      setLastTrace(trace);
      setSelectedTreeNode(null);
      setQueryMs(Math.max(1, Math.round(t1 - t0)));
    } catch (e) {
      if (e instanceof RAError) {
        setError(e.message);
        if (e.pos) setErrorPos({ line: e.pos.line, column: e.pos.column });
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      setResult(null);
      setLastProgram(null);
      setLastTrace(new Map());
      setSelectedTreeNode(null);
      setQueryMs(null);
    }
  }, [editorMode, query, tablesData, importedRelations]);

  /** Swap the active editor mode. Preserves both text buffers via the
   *  bufferedQuery shadow. Resets transient UI state (autocomplete, errors). */
  const switchEditorMode = useCallback((next: 'algebra' | 'sql') => {
    setEditorMode(prev => {
      if (prev === next) return prev;
      // Swap active/buffered text in a single commit so the editor doesn't
      // flash an empty/stale value during the transition.
      setQuery(currentActive => {
        setBufferedQuery(currentActive);
        return bufferedQuery;
      });
      setError(null);
      setErrorPos(null);
      setSqlTranslationNote(null);
      setAcVisible(false);
      setCaretPos(0);
      return next;
    });
    // Warm up sql.js WASM when the user enters the SQL tab so the first
    // query feels instant. Fire-and-forget — failures will surface on the
    // actual execute call.
    if (next === 'sql') {
      initSqlEngine().catch(() => { /* swallow — will retry on execute */ });
    }
  }, [bufferedQuery]);

  // Same warm-up if the SQL tab is already active on mount (persisted state).
  useEffect(() => {
    if (editorMode === 'sql') {
      initSqlEngine().catch(() => { /* swallow */ });
    }
  // intentionally run once on mount only — re-warming on every editorMode
  // change is already handled by switchEditorMode.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Insert text at the caret with context-aware padding. The kind tells us
   * how to space the inserted token relative to its neighbours:
   *   - 'name'   → relation or column name: pad before AND after.
   *   - 'unary'  → prefix operator (σ π ρ ¬): pad before only — the body
   *                that follows is "_{…}" or "(…)" with no space.
   *   - 'binary' → infix operator or comparison: pad before AND after.
   *   - 'punct'  → punctuation like ".": no padding.
   *
   * Padding is suppressed when the adjacent char is already whitespace or
   * a natural boundary like "(", "{", ",", ")", "}", start/end of input.
   */
  const insertAtCaret = useCallback((text: string, kind: InsertKind = 'name') => {
    const ta = editorRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;

    const before = (start > 0 ? ta.value[start - 1] : '');
    const after = (end < ta.value.length ? ta.value[end] : '');

    const isOpenBoundary = (c: string) => c === '' || /\s/.test(c) || c === '(' || c === '{' || c === ',';
    const isCloseBoundary = (c: string) => c === '' || /\s/.test(c) || c === ')' || c === '}' || c === ',' || c === ';';

    let padBefore = false;
    let padAfter = false;
    if (kind === 'name' || kind === 'binary') {
      padBefore = !isOpenBoundary(before);
      padAfter = !isCloseBoundary(after);
    } else if (kind === 'unary') {
      padBefore = !isOpenBoundary(before);
      // no padAfter — unary prefix glues to its argument (σ_{…}, ¬cond, …)
    }
    // 'punct' → no padding.

    const inserted = (padBefore ? ' ' : '') + text + (padAfter ? ' ' : '');
    setQuery(prev => prev.slice(0, start) + inserted + prev.slice(end));

    const caretAfter = start + inserted.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = caretAfter;
    });
  }, []);

  const insertSymbol = (sym: string, kind: InsertKind) => insertAtCaret(sym, kind);

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
    setLastProgram(null);
    setLastTrace(new Map());
    setSelectedTreeNode(null);
    setQueryMs(null);
  };

  // ---- Autocomplete: schema, current word, contextual suggestions ----

  type Suggestion = PredictSuggestion;

  /**
   * Schema + sample data for the smart autocomplete. Sample values are pulled
   * from the actual rows so suggestions like the RHS of `did = ?` show real
   * existing values from the loaded data.
   */
  const acSchema = useMemo(() => {
    const relations: string[] = [];
    const colsByRel = new Map<string, string[]>();
    const sampleValuesByCol = new Map<string, string[]>();
    const stringify = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      if (v instanceof Date) return `'${v.toISOString().slice(0, 10)}'`;
      if (typeof v === 'string') return `'${v}'`;
      if (typeof v === 'number') return String(v);
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      return String(v);
    };
    const collect = (relName: string, rel: { columns: { name: string; type: string }[]; rows: unknown[][] }) => {
      relations.push(relName);
      colsByRel.set(relName, rel.columns.map(c => c.name));
      rel.columns.forEach((c, ci) => {
        const seen = new Set<string>();
        const samples: string[] = [];
        for (const row of rel.rows) {
          const v = row[ci];
          if (v === null || v === undefined) continue;
          const s = stringify(v);
          if (!seen.has(s)) { seen.add(s); samples.push(s); }
          if (samples.length >= 5) break;
        }
        if (samples.length > 0) sampleValuesByCol.set(`${relName}.${c.name}`, samples);
      });
    };
    tables.forEach(t => collect(t.name, {
      columns: t.columns.filter(c => !c.isDerived).map(c => ({ name: c.name, type: 'string' })),
      rows: tablesData.get(t.name)?.rows ?? [],
    }));
    importedRelations.forEach((rel, name) => {
      if (!relations.includes(name)) collect(name, { columns: rel.columns, rows: rel.rows });
    });
    const allColumns = Array.from(new Set(Array.from(colsByRel.values()).flat()));
    return { relations, colsByRel, allColumns, sampleValuesByCol };
  }, [tables, importedRelations, tablesData]);

  /** Word-bound currently being typed (alnum + `_` + `.`). Shared with the
   *  predict engine via wordAtCaret() so both stay in sync. */
  const { currentWord, wordStart } = useMemo(() => {
    const r = wordAtCaret(query, caretPos);
    return { currentWord: r.word, wordStart: r.start };
  }, [query, caretPos]);

  /**
   * Smart autocomplete — delegated to the predict engine which walks the
   * token stream up to the caret and returns suggestions whose KIND depends
   * on what the parser would legally accept next.
   */
  /** Suggestions for the ALGEBRA editor. SQL mode uses CodeMirror's built-in
   *  autocomplete dropdown — we don't compute these in SQL mode. */
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!acVisible || editorMode === 'sql') return [];
    return predictNext(query, caretPos, {
      relations: acSchema.relations,
      columnsByRel: acSchema.colsByRel,
      allColumns: acSchema.allColumns,
      sampleValuesByCol: acSchema.sampleValuesByCol,
      derivedRelations: Array.from(derived.keys()),
    });
  }, [acVisible, editorMode, query, caretPos, acSchema, derived]);

  // Reset selection index when suggestions list changes
  useEffect(() => { setAcIndex(0); }, [suggestions.length, currentWord]);

  /** Apply an algebra-query command pushed from the chat. We can't call
   *  runQuery() right after setQuery() — runQuery closes over the previous
   *  query value. Instead we set a "run pending" flag that a second effect
   *  reads after React has committed the new query state. */
  const lastPendingAtRef = useRef<number>(0);
  const [pendingRun, setPendingRun] = useState(false);

  useEffect(() => {
    if (!pendingQuery) return;
    if (pendingQuery.at <= lastPendingAtRef.current) return;
    lastPendingAtRef.current = pendingQuery.at;
    // The chat protocol always emits algebra expressions, so force the editor
    // into algebra mode before applying — otherwise the SQL parser would
    // reject Greek-letter syntax.
    if (editorMode !== 'algebra') {
      setBufferedQuery(query);
      setEditorMode('algebra');
    }
    setQuery(pendingQuery.query);
    setCaretPos(pendingQuery.query.length);
    setAcVisible(false);
    if (pendingQuery.run) setPendingRun(true);
    requestAnimationFrame(() => {
      const ta = editorRef.current;
      if (ta) {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = pendingQuery.query.length;
      }
    });
    onPendingQueryConsumed?.();
    // editorMode/query are intentionally not in deps: this effect must fire
    // only when a new pendingQuery arrives, not when the user switches tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuery, onPendingQueryConsumed]);

  useEffect(() => {
    if (!pendingRun) return;
    runQuery();
    setPendingRun(false);
  }, [pendingRun, runQuery]);

  /** Apply an algebra-data ABM mutation. The parent already collected the
   *  user's confirmation, so we just mutate the right state map here. The
   *  five actions cover append, replace, update-row, delete-rows and
   *  create-relation. */
  const lastDataAtRef = useRef<number>(0);
  useEffect(() => {
    if (!pendingDataChange) return;
    if (pendingDataChange.at <= lastDataAtRef.current) return;
    lastDataAtRef.current = pendingDataChange.at;

    const { action, relation, columns, rows, rowIndex, values, rowIndices } = pendingDataChange;

    /** Find the relation in either tablesData (schema-bound) or
     *  importedRelations (ad-hoc). Returns the bag name so we know which
     *  setter to use. */
    const findBag = (): 'tables' | 'imported' | null => {
      if (tablesData.has(relation)) return 'tables';
      if (importedRelations.has(relation)) return 'imported';
      // The schema may know the table but no data has been loaded yet.
      if (tables.some(t => t.name === relation)) return 'tables';
      return null;
    };

    const coerceCell = (raw: string | number | boolean | null, type: ColumnType): Value => {
      if (raw === null || raw === undefined) return null;
      if (type === 'number') return typeof raw === 'number' ? raw : Number(raw);
      if (type === 'boolean') return typeof raw === 'boolean' ? raw : String(raw).toLowerCase() === 'true';
      if (type === 'date') {
        // The wire format from the AI is string/number/boolean/null only;
        // dates arrive as ISO strings.
        const d = new Date(String(raw));
        return Number.isNaN(d.getTime()) ? String(raw) : d;
      }
      return String(raw);
    };

    if (action === 'create-relation') {
      if (!columns || columns.length === 0) return;
      const rel: Relation = {
        columns: columns.map(c => ({ name: c.name, type: c.type })),
        rows: (rows ?? []).map(r => r.map((v, ci) => coerceCell(v, columns[ci].type))),
      };
      // New relations land in importedRelations (the ad-hoc bag) so they
      // don't fight a schema definition that doesn't exist.
      setImportedRelations(prev => {
        const next = new Map(prev);
        next.set(relation, rel);
        return next;
      });
      onPendingDataConsumed?.();
      return;
    }

    const bag = findBag();
    if (!bag) {
      alert(`No encontré la relación "${relation}". Tal vez se llama distinto o todavía no fue importada.`);
      onPendingDataConsumed?.();
      return;
    }
    // Read current relation
    const current = bag === 'tables' ? tablesData.get(relation) : importedRelations.get(relation);
    // If schema-bound and not yet loaded, seed from the schema columns.
    const seedFromSchema = (): Relation => {
      const t = tables.find(t => t.name === relation);
      const cols: { name: string; type: ColumnType }[] = t
        ? t.columns.filter(c => !c.isDerived).map(c => ({ name: c.name, type: 'string' as ColumnType }))
        : [];
      return { columns: cols, rows: [] };
    };
    const baseline: Relation = current ?? seedFromSchema();

    const applyTo = (rel: Relation): Relation => {
      switch (action) {
        case 'append': {
          const newRows = (rows ?? []).map(r => r.map((v, ci) => coerceCell(v, rel.columns[ci]?.type ?? 'string')));
          return { columns: rel.columns, rows: [...rel.rows, ...newRows] };
        }
        case 'replace': {
          const newRows = (rows ?? []).map(r => r.map((v, ci) => coerceCell(v, rel.columns[ci]?.type ?? 'string')));
          return { columns: rel.columns, rows: newRows };
        }
        case 'update-row': {
          if (rowIndex === undefined || rowIndex < 0 || rowIndex >= rel.rows.length) return rel;
          const newRow = [...rel.rows[rowIndex]];
          for (const [k, v] of Object.entries(values ?? {})) {
            const ci = rel.columns.findIndex(c => c.name === k);
            if (ci >= 0) newRow[ci] = coerceCell(v, rel.columns[ci].type);
          }
          const newRows = rel.rows.map((r, i) => i === rowIndex ? newRow : r);
          return { columns: rel.columns, rows: newRows };
        }
        case 'delete-rows': {
          const drop = new Set(rowIndices ?? []);
          return { columns: rel.columns, rows: rel.rows.filter((_, i) => !drop.has(i)) };
        }
        default:
          return rel;
      }
    };

    const next = applyTo(baseline);
    if (bag === 'tables') {
      setTablesData(prev => { const n = new Map(prev); n.set(relation, next); return n; });
    } else {
      setImportedRelations(prev => { const n = new Map(prev); n.set(relation, next); return n; });
    }
    onPendingDataConsumed?.();
  }, [pendingDataChange, tablesData, importedRelations, tables, onPendingDataConsumed]);

  /**
   * Insert a suggestion in place of the partial word the user is typing,
   * with context-aware padding so tokens don't run into each other.
   *
   * Pad policy per suggestion type:
   *   name   (relation, column) → pad before AND after if neighbours aren't boundaries
   *   binary (= ≠ < > ≤ ≥ ∧ ∨ ⋈ ⨯ ÷ ∪ ∩ − → and σ π ρ)
   *                              → pad before AND after if neighbours aren't boundaries
   *   comma  (',')               → pad after only (",")
   *   lparen ('(')                → pad before only ("X (")
   *   punct  ('.')                → no padding
   *
   * Each pad is suppressed when the adjacent char is whitespace or a natural
   * boundary, so repeated clicks don't accumulate double spaces.
   */
  const acceptSuggestion = useCallback((s: Suggestion) => {
    // Default pad based on suggestion kind
    const pad: 'name' | 'binary' | 'comma' | 'lparen' | 'punct' | 'none' = s.pad ??
      (s.kind === 'relation' || s.kind === 'column' || s.kind === 'literal' ? 'name' :
        s.kind === 'template' ? 'none' : 'binary');

    const before = wordStart > 0 ? query[wordStart - 1] : '';
    const after = caretPos < query.length ? query[caretPos] : '';

    const isOpenBoundary = (c: string) =>
      c === '' || /\s/.test(c) || c === '(' || c === '{' || c === ',' || c === '_';
    const isCloseBoundary = (c: string) =>
      c === '' || /\s/.test(c) || c === ')' || c === '}' || c === ',' || c === ';' || c === '.';

    let padBefore = false;
    let padAfter = false;
    switch (pad) {
      case 'name':
      case 'binary':
        padBefore = !isOpenBoundary(before);
        padAfter = !isCloseBoundary(after);
        break;
      case 'comma':
        padAfter = !isCloseBoundary(after);
        break;
      case 'lparen':
        padBefore = !isOpenBoundary(before);
        break;
      case 'punct':
      case 'none':
        break;
    }

    const insert = (padBefore ? ' ' : '') + s.text + (padAfter ? ' ' : '');
    setQuery(prev => prev.slice(0, wordStart) + insert + prev.slice(caretPos));

    // Caret placement: templates can request a specific offset within their text
    // (e.g. landing on the first placeholder); everything else ends after the
    // inserted token + trailing pad.
    const baseOffset = padBefore ? 1 : 0;
    const newCaret = wordStart + (s.caretOffset !== undefined
      ? baseOffset + s.caretOffset
      : insert.length);

    requestAnimationFrame(() => {
      const ta = editorRef.current;
      if (ta) {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = newCaret;
        setCaretPos(newCaret);
      }
    });
  }, [wordStart, caretPos, query]);

  const updateCaret = () => {
    const ta = editorRef.current;
    if (ta) setCaretPos(ta.selectionStart);
  };

  // ---- derived helpers ----

  /** Memoized highlight output to avoid re-walking the entire query text on
   *  every render — caret moves, mouse hovers and AC index changes all
   *  trigger renders and we don't want to recompute spans for each. */
  /** Highlight nodes for the ALGEBRA editor only. SQL mode uses CodeMirror,
   *  which has its own highlighter and we don't compute these nodes there. */
  const highlightedNodes = useMemo(
    () => highlightQuery(query, { relations: acSchema.relations, columns: acSchema.allColumns }),
    [query, acSchema.relations, acSchema.allColumns],
  );

  /**
   * Inline ghost-text completion. Shows the top autocomplete suggestion as
   * faint italic text directly after the caret, like Copilot. Press Tab to
   * accept it (already wired in the keydown handler).
   *
   * Only renders when the caret is at the END of the query — mid-string
   * ghost text would clash with the existing tail of the line.
   *
   * If the top suggestion's label starts with whatever the user is mid-typing
   * (the "currentWord"), only the REMAINING characters are rendered as
   * ghost so the visible text reads as if the suggestion were already half-
   * typed.
   */
  const ghostText = useMemo(() => {
    if (!acVisible) return '';
    if (caretPos !== query.length) return '';
    const top = suggestions[0];
    if (!top) return '';
    const wordLower = currentWord.toLowerCase();
    const labelLower = top.label.toLowerCase();
    if (wordLower) {
      // Only show ghost when the suggestion CONTINUES what the user is typing.
      // Showing an unrelated label here is misleading.
      if (labelLower.startsWith(wordLower)) return top.label.slice(currentWord.length);
      return '';
    }
    // Empty word: show full label, with a leading space when the previous
    // char isn't already a natural boundary.
    const needsLeadingSpace = query.length > 0 && !/[\s({,_]$/.test(query);
    return (needsLeadingSpace ? ' ' : '') + top.label;
  }, [acVisible, caretPos, query, currentWord, suggestions]);

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
          <button
            className="algebra-btn primary"
            onClick={runQuery}
            disabled={isExecuting}
            title={isExecuting ? 'Esperando motor SQL…' : 'Ctrl+Enter'}
          >
            {isExecuting ? '⏳ Ejecutando…' : '▶ Ejecutar'}
          </button>
          <button className="algebra-btn" onClick={clearEditor}>Limpiar</button>
          <button className="algebra-btn" onClick={exportResultCSV} disabled={!result}>
            Exportar CSV
          </button>
        </div>
      </div>

      <div
        className="algebra-body"
        data-layout={resultLayout}
        style={(() => {
          // Layout 'side' — three columns in a single row. Hidden panels drop
          //                 themselves AND their adjacent 5px splitter track.
          // Layout 'below' — tables stays in the left column spanning every
          //                  row; editor sits top-right, result bottom-right,
          //                  with a horizontal splitter between them.
          if (resultLayout === 'below') {
            const cols: string[] = [];
            if (showTables) cols.push(`${tablesPanelWidth}px`, '5px');
            cols.push('1fr');
            const rows: string[] = ['1fr'];
            if (showResult) rows.push('5px', `${resultPanelHeight}px`);
            return {
              gridTemplateColumns: cols.join(' '),
              gridTemplateRows: rows.join(' '),
            };
          }
          // Side layout
          const cols: string[] = [];
          if (showTables) cols.push(`${tablesPanelWidth}px`, '5px');
          if (showResult) cols.push(`${editorPanelWidth}px`, '5px', '1fr');
          else            cols.push('1fr');
          return {
            gridTemplateColumns: cols.join(' '),
            gridTemplateRows: '1fr',
          };
        })()}
      >
        {/* ===== LEFT: Tables — spans every row when result sits below ===== */}
        {showTables && (<>
        <div className="algebra-panel" style={resultLayout === 'below' ? { gridRow: '1 / -1' } : undefined}>
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
                <div className="ra-section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <span>Relaciones importadas ({importedRelations.size})</span>
                  {onApplyReverseEngineeredER && (
                    <button
                      className="algebra-btn"
                      style={{ fontSize: '0.65rem', padding: '2px 6px', textTransform: 'none', letterSpacing: 0 }}
                      title="Generar diagrama ER y esquema a partir de las relaciones importadas. Reemplaza el ER actual y mueve los datos a las tablas del esquema."
                      onClick={() => {
                        if (!confirm('Esto reemplaza el diagrama ER actual con uno generado a partir de las relaciones importadas. Los datos de los CSVs van a quedar asociados a las tablas del esquema. ¿Continuar?')) return;
                        const { nodes: erNodes, connections: erConns, notes } = reverseEngineerER(importedRelations);

                        // Migrar los datos de las CSVs importadas a las tablas
                        // del esquema (mismo nombre). Sin esta migración la
                        // misma relación aparece dos veces: como tabla del
                        // esquema (vacía) y como relación importada (con datos).
                        const migratedTablesData = new Map(tablesData);
                        importedRelations.forEach((rel, name) => { migratedTablesData.set(name, rel); });
                        const clearedImports = new Map<string, Relation>();
                        setTablesData(migratedTablesData);
                        setImportedRelations(clearedImports);

                        // Persistir IMMEDIATAMENTE — el tab va a cambiar a ER
                        // y AlgebraView se desmonta; la useEffect de debounce
                        // (400 ms) sería cancelada y los cambios se perderían.
                        try {
                          const tablesSerialized: Record<string, SerializedRelation> = {};
                          migratedTablesData.forEach((rel, name) => { tablesSerialized[name] = serializeRelation(rel); });
                          localStorage.setItem(STORAGE_KEY, JSON.stringify({
                            query,
                            tablesData: tablesSerialized,
                            importedRelations: {},
                          } satisfies Persisted));
                        } catch { /* storage quota etc. — ignore */ }

                        onApplyReverseEngineeredER(erNodes, erConns, notes);
                      }}
                    >
                      ✨ Generar ER
                    </button>
                  )}
                </div>
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

        <Splitter
          orientation="vertical"
          title="Arrastrar para cambiar el ancho del panel de tablas"
          onDragStart={() => { tablesDragBaseline.current = tablesPanelWidth; }}
          onDrag={(delta) => {
            const next = Math.max(180, Math.min(600, tablesDragBaseline.current + delta));
            setTablesPanelWidth(next);
          }}
          style={resultLayout === 'below' ? { gridRow: '1 / -1' } : undefined}
        />
        </>)}
        {/* ===== CENTER: Editor ===== */}
        <div
          className={`algebra-panel ra-mode-${editorMode}`}
          style={resultLayout === 'below'
            ? { gridColumn: showTables ? '3' : '1', gridRow: '1' }
            : undefined}
        >
          <div className="algebra-panel-header">
            <span>Consulta</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {editorMode === 'sql'
                ? 'SQL → álgebra · Ctrl+Enter para ejecutar'
                : 'Unicode o ASCII · Ctrl+Enter para ejecutar'}
            </span>
          </div>
          {/* Sub-tabs: Álgebra vs SQL. Same evaluator, same schemas, separate buffer. */}
          <div className="ra-mode-tabs" role="tablist" aria-label="Modo de consulta">
            <button
              role="tab"
              aria-selected={editorMode === 'algebra'}
              className={`ra-mode-tab ${editorMode === 'algebra' ? 'is-active' : ''}`}
              onClick={() => switchEditorMode('algebra')}
              title="Álgebra relacional (σ π ρ ⋈ ⨯ ÷ ∪ ∩ −)"
            >
              <span className="ra-mode-tab-glyph">σπρ</span>
              Álgebra
            </button>
            <button
              role="tab"
              aria-selected={editorMode === 'sql'}
              className={`ra-mode-tab ${editorMode === 'sql' ? 'is-active' : ''}`}
              onClick={() => switchEditorMode('sql')}
              title="SQL (se traduce a álgebra antes de ejecutar)"
            >
              <span className="ra-mode-tab-glyph">SQL</span>
              SQL
            </button>
          </div>
          <div className="ra-editor-wrap">
            {editorMode === 'sql' ? (
              // SQL: CodeMirror 6 with @codemirror/lang-sql owns the editor.
              // Schema-aware autocomplete, syntax highlight, bracket matching,
              // multi-cursor, search — all built in.
              <SqlEditor
                value={query}
                onChange={(v) => { setQuery(v); }}
                schema={{ columnsByTable: acSchema.colsByRel }}
                onRun={runQuery}
              />
            ) : (
              <>
                {/* Algebra mode keeps the custom transparent textarea + overlay
                    so the Greek-letter highlight, ghost-text and Alt+letter
                    shortcuts (σπρ⋈⨯÷∪∩−) keep working as before. */}
                <div ref={highlightRef} className="ra-editor-highlight" aria-hidden>
                  {highlightedNodes.slice(0, -1)}
                  {ghostText && <span className="ra-ghost">{ghostText}</span>}
                  {highlightedNodes[highlightedNodes.length - 1]}
                </div>
                <textarea
                  ref={editorRef}
                  className="ra-editor"
                  value={query}
            onChange={e => {
              setQuery(e.target.value);
              setAcVisible(true);
              // Critical: keep caretPos in sync with what the user just typed.
              // Without this, suggestions stay locked at the previous caret
              // (typically 0 on mount) so the state machine never advances.
              setCaretPos(e.target.selectionStart);
            }}
            onSelect={updateCaret}
            onClick={updateCaret}
            onKeyUp={updateCaret}
            onScroll={(e) => {
              // Mirror scroll into the highlight overlay so the colors stay aligned.
              const ta = e.currentTarget;
              if (highlightRef.current) {
                highlightRef.current.scrollTop = ta.scrollTop;
                highlightRef.current.scrollLeft = ta.scrollLeft;
              }
            }}
            onKeyDown={e => {
              // ── Symbol keyboard shortcuts (Alt+letter / ⌥+letter on Mac) ──
              // Intercepted BEFORE the default handler so the OS doesn't
              // produce accented chars (e.g. ⌥+S = ß on Mac).
              // SQL mode: skip the Greek-letter shortcuts entirely so the user
              // can type the SQL alphabet without surprises.
              if (editorMode === 'algebra' && e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
                const k = e.key.toLowerCase();
                const sym = KEY_TO_SYMBOL[k];
                if (sym) {
                  e.preventDefault();
                  const ta = editorRef.current;
                  if (!ta) return;
                  const start = ta.selectionStart;
                  const end = ta.selectionEnd;
                  setQuery(prev => prev.slice(0, start) + sym + prev.slice(end));
                  const next = start + sym.length;
                  requestAnimationFrame(() => {
                    ta.focus();
                    ta.selectionStart = ta.selectionEnd = next;
                    setCaretPos(next);
                    setAcVisible(true);
                  });
                  return;
                }
              }
              // Run query
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                runQuery();
                return;
              }
              // Autocomplete: navigate + accept. Only algebra mode reaches
              // this textarea — SQL mode is owned by CodeMirror upstream and
              // never renders this textarea or its handlers.
              if (suggestions.length > 0 && acVisible) {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  acceptSuggestion(suggestions[acIndex] ?? suggestions[0]);
                  return;
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setAcIndex(i => Math.min(i + 1, suggestions.length - 1));
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setAcIndex(i => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setAcVisible(false);
                  return;
                }
              }
            }}
                  spellCheck={false}
                />
              </>
            )}
          </div>
          {suggestions.length > 0 && acVisible && (
            <div className="ra-autocomplete">
              {suggestions.map((s, i) => (
                <button
                  key={s.text + ':' + i}
                  className={`ra-ac-item ${s.kind} ${i === acIndex ? 'selected' : ''}`}
                  onClick={() => acceptSuggestion(s)}
                  onMouseEnter={() => setAcIndex(i)}
                  title={s.hint ?? s.kind}
                >
                  <span className="ra-ac-label">{s.label}</span>
                  {s.hint && <span className="ra-ac-hint">{s.hint}</span>}
                </button>
              ))}
              <span className="ra-ac-tip">
                <kbd>Tab</kbd> insertar · <kbd>↑↓</kbd> navegar · <kbd>Esc</kbd> ocultar
              </span>
            </div>
          )}
          {sqlTranslationNote && (
            <div className="ra-sql-banner" title="El editor reconoció SQL y lo tradujo a álgebra antes de ejecutar.">
              <span className="ra-sql-icon">↪</span>
              <span>{sqlTranslationNote}</span>
              <button
                className="ra-sql-dismiss"
                onClick={() => setSqlTranslationNote(null)}
                title="Cerrar este aviso"
              >×</button>
            </div>
          )}
          {editorMode === 'algebra' && <AlgebraPreview query={query} />}
          {editorMode === 'algebra' && <div className="ra-symbols-bar">
            {SYMBOLS.map(s => (
              <button
                key={s.sym}
                className="ra-symbol-btn"
                title={`${s.sym} — ${s.tip}${s.shortcut ? `   (${ALT_LABEL}${s.shortcut})` : ''}`}
                onClick={() => insertSymbol(s.sym, s.kind)}
              >
                <span className="ra-symbol-glyph">{s.sym}</span>
                {s.shortcut && <span className="ra-symbol-kbd">{s.shortcut}</span>}
              </button>
            ))}
          </div>}
        </div>

        {showResult && (<>
        {resultLayout === 'side' ? (
          <Splitter
            orientation="vertical"
            title="Arrastrar para cambiar el ancho del panel de consulta"
            onDragStart={() => { editorDragBaseline.current = editorPanelWidth; }}
            onDrag={(delta) => {
              const next = Math.max(260, Math.min(900, editorDragBaseline.current + delta));
              setEditorPanelWidth(next);
            }}
          />
        ) : (
          // 'below' layout — horizontal splitter sits in row 2 of the editor
          // column (col 3 when tables are visible, col 1 when they aren't).
          // Drag moves the boundary between editor area and result area
          // vertically; positive delta (mouse down) shrinks the result.
          <Splitter
            orientation="horizontal"
            title="Arrastrar para cambiar el alto del panel de resultado"
            onDragStart={() => { resultHeightDragBaseline.current = resultPanelHeight; }}
            onDrag={(delta) => {
              const next = Math.max(120, Math.min(800, resultHeightDragBaseline.current - delta));
              setResultPanelHeight(next);
            }}
            style={{ gridColumn: showTables ? '3' : '1' }}
          />
        )}
        {/* ===== RIGHT (or BOTTOM): Result ===== */}
        <div
          className="algebra-panel"
          style={resultLayout === 'below'
            ? { gridColumn: showTables ? '3' : '1', gridRow: '3' }
            : undefined}
        >
          <div className="algebra-panel-header">
            <span>Resultado</span>
            {/* In-panel toggles: hide/show the execution tree and the data
                table independently. Pure UI affordance — also exposed in
                the ⚙ menu but easier to reach from here. */}
            <span style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 8 }}>
              <button
                className={`algebra-btn ${showResultTree ? 'primary' : ''}`}
                style={{ fontSize: '0.65rem', padding: '2px 6px' }}
                onClick={() => setShowResultTree(!showResultTree)}
                title="Mostrar / ocultar el árbol de ejecución"
              >▸ árbol</button>
              <button
                className={`algebra-btn ${showResultData ? 'primary' : ''}`}
                style={{ fontSize: '0.65rem', padding: '2px 6px' }}
                onClick={() => setShowResultData(!showResultData)}
                title="Mostrar / ocultar la tabla de datos"
              >▦ datos</button>
            </span>
            <span style={{ display: 'flex', gap: 10, alignItems: 'center', marginLeft: 'auto' }}>
              {queryMs !== null && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{queryMs} ms</span>}
              {selectedTreeNode && result && (
                <button
                  className="algebra-btn"
                  style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                  onClick={() => { setSelectedTreeNode(null); setResult(lastTrace.get(lastProgram?.statements.slice(-1)[0]?.expr as RelExpr) ?? result); }}
                  title="Volver al resultado final"
                >↺ final</button>
              )}
              {result && <span>{result.rows.length} filas · {result.columns.length} columnas</span>}
            </span>
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
            {!error && result && showResultTree && lastProgram && lastTrace.size > 0 && (
              <AlgebraTree
                program={lastProgram}
                trace={lastTrace}
                selectedNode={selectedTreeNode}
                onSelectNode={(node, rel) => {
                  setSelectedTreeNode(node);
                  setResult(rel);
                }}
              />
            )}
            {!error && result && showResultData && (
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
        </>)}
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

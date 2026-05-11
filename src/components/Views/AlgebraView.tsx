import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RelationalTable } from '../../utils/relationalSchema';
import type { ColumnType, Program, RelExpr, Relation, Value } from '../../utils/relAlgebra/types';
import { RAError } from '../../utils/relAlgebra/types';
import { parse } from '../../utils/relAlgebra/parser';
import { evaluate } from '../../utils/relAlgebra/evaluator';
import { tokenize, type Token } from '../../utils/relAlgebra/tokenizer';
import { parseCSV, relationToCSV } from '../../utils/relAlgebra/csvLoader';
import { generateSampleRelation } from '../../utils/relAlgebra/sampleData';
import AlgebraPreview from './AlgebraPreview';
import AlgebraTree from './AlgebraTree';
import { highlight as highlightQuery } from './algebraHighlight';
import './AlgebraView.css';

interface AlgebraViewProps {
  tables: RelationalTable[];
}

const STORAGE_KEY = 'derup.algebra.v1';

/**
 * Each symbol declares whether it wants automatic padding around it when
 * inserted via click. Unary prefix operators (σ π ρ ¬) pad before only —
 * a trailing space would look weird in "σ_{...}". Binary operators and
 * comparators pad on both sides. Punctuation like "." pads nothing.
 */
type InsertKind = 'name' | 'unary' | 'binary' | 'punct';
const SYMBOLS: { sym: string; tip: string; kind: InsertKind }[] = [
  { sym: 'σ', tip: 'σ — selección', kind: 'unary' },
  { sym: 'π', tip: 'π — proyección', kind: 'unary' },
  { sym: 'ρ', tip: 'ρ — renombrar', kind: 'unary' },
  { sym: '⋈', tip: '⋈ — junta natural', kind: 'binary' },
  { sym: '⨯', tip: '⨯ — producto cartesiano', kind: 'binary' },
  { sym: '÷', tip: '÷ — división', kind: 'binary' },
  { sym: '∪', tip: '∪ — unión', kind: 'binary' },
  { sym: '∩', tip: '∩ — intersección', kind: 'binary' },
  { sym: '−', tip: '− — diferencia', kind: 'binary' },
  { sym: '∧', tip: '∧ — AND lógico', kind: 'binary' },
  { sym: '∨', tip: '∨ — OR lógico', kind: 'binary' },
  { sym: '¬', tip: '¬ — NOT lógico', kind: 'unary' },
  { sym: '≠', tip: '≠ — distinto', kind: 'binary' },
  { sym: '≤', tip: '≤ — menor o igual', kind: 'binary' },
  { sym: '≥', tip: '≥ — mayor o igual', kind: 'binary' },
  { sym: '→', tip: '→ — flecha (renombrar columna)', kind: 'binary' },
  { sym: '.', tip: '. — calificador R.col', kind: 'punct' },
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

  // Last successful execution — kept for tree visualization and intermediate-result drill-down.
  const [lastProgram, setLastProgram] = useState<Program | null>(null);
  const [lastTrace, setLastTrace] = useState<Map<RelExpr, Relation>>(new Map());
  const [selectedTreeNode, setSelectedTreeNode] = useState<RelExpr | null>(null);
  const [queryMs, setQueryMs] = useState<number | null>(null);

  // ----- Autocomplete state -----
  const [caretPos, setCaretPos] = useState(0);
  const [acVisible, setAcVisible] = useState(true);
  const [acIndex, setAcIndex] = useState(0);

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
      const env = new Map<string, Relation>();
      tablesData.forEach((rel, name) => env.set(name, rel));
      importedRelations.forEach((rel, name) => env.set(name, rel));
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
  }, [query, tablesData, importedRelations]);

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

  type Suggestion = {
    text: string;       // what gets inserted (no automatic padding — caller handles)
    label: string;      // what shows in the chip
    hint?: string;      // small badge (relation name for columns, etc.)
    kind: 'relation' | 'column' | 'operator';
    // Padding policy at insertion time. Defaults: relation/column → 'name';
    // operator → 'binary' (pad both sides); exceptions ('(' ',' '.') override.
    pad?: 'name' | 'binary' | 'comma' | 'lparen' | 'punct';
  };

  /** Map of all known relations to their columns, used to drive suggestions. */
  const acSchema = useMemo(() => {
    const relations: string[] = [];
    const colsByRel = new Map<string, string[]>();
    tables.forEach(t => {
      relations.push(t.name);
      colsByRel.set(t.name, t.columns.filter(c => !c.isDerived).map(c => c.name));
    });
    importedRelations.forEach((rel, name) => {
      if (!relations.includes(name)) relations.push(name);
      colsByRel.set(name, rel.columns.map(c => c.name));
    });
    const allCols = Array.from(new Set(Array.from(colsByRel.values()).flat()));
    return { relations, colsByRel, allCols };
  }, [tables, importedRelations]);

  /** Word-bound currently being typed (alnum + `_` + `.`). */
  const { currentWord, wordStart } = useMemo(() => {
    let i = caretPos;
    while (i > 0 && /[a-zA-Z0-9_.]/.test(query[i - 1])) i--;
    return { currentWord: query.slice(i, caretPos), wordStart: i };
  }, [query, caretPos]);

  /**
   * Detect what kind of construct the caret is inside by tokenizing the prefix
   * up to the caret and walking the token stream backwards to find an
   * unmatched σ / π / ρ operator (i.e. one whose body the caret is in).
   */
  type SyntaxContext =
    | { kind: 'select-cond'; bodyTokens: Token[] }
    | { kind: 'project-cols'; bodyTokens: Token[] }
    | { kind: 'rename-args'; bodyTokens: Token[] }
    | { kind: 'top' };

  const syntaxContext = useMemo<SyntaxContext>(() => {
    const prefix = query.slice(0, caretPos);
    let tokens: Token[] = [];
    try { tokens = tokenize(prefix).filter(t => t.kind !== 'EOF'); }
    catch { return { kind: 'top' }; }

    // Walk backwards: count parens/braces; find the last operator at top depth.
    let depth = 0;
    let opIdx = -1;
    let opKind = '';
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      if (t.kind === 'RPAREN' || t.kind === 'RBRACE') { depth++; continue; }
      if (t.kind === 'LPAREN' || t.kind === 'LBRACE') {
        if (depth === 0) {
          // We crossed an unmatched opening — we're inside that group, which
          // could be the brace-form body of σ_{...}: check if the previous
          // token (after optional UNDERSCORE) is an operator.
          let j = i - 1;
          if (j >= 0 && tokens[j].kind === 'UNDERSCORE') j--;
          if (j >= 0 && (tokens[j].kind === 'OP_SELECT' || tokens[j].kind === 'OP_PROJECT' || tokens[j].kind === 'OP_RENAME')) {
            opIdx = j;
            opKind = tokens[j].kind;
          }
          break;
        }
        depth--; continue;
      }
      if (depth === 0 && (t.kind === 'OP_SELECT' || t.kind === 'OP_PROJECT' || t.kind === 'OP_RENAME')) {
        opIdx = i;
        opKind = t.kind;
        break;
      }
    }
    if (opIdx < 0) return { kind: 'top' };

    // Check whether we've already moved past the operator's body into the
    // relation argument: i.e. there's an LPAREN at depth 0 between the
    // operator and the caret.
    const after = tokens.slice(opIdx + 1);
    let d = 0;
    let pastBody = false;
    for (const t of after) {
      if (t.kind === 'LPAREN' || t.kind === 'LBRACE') {
        if (d === 0 && t.kind === 'LPAREN' && !pastBody) {
          // First top-level LPAREN after the operator → start of relation arg.
          pastBody = true;
        }
        d++;
      } else if (t.kind === 'RPAREN' || t.kind === 'RBRACE') {
        d--;
      }
    }
    if (pastBody && d === 0) return { kind: 'top' };
    if (pastBody) return { kind: 'top' }; // inside the relation arg → suggest relations

    const bodyTokens = after;
    if (opKind === 'OP_SELECT') return { kind: 'select-cond', bodyTokens };
    if (opKind === 'OP_PROJECT') return { kind: 'project-cols', bodyTokens };
    if (opKind === 'OP_RENAME') return { kind: 'rename-args', bodyTokens };
    return { kind: 'top' };
  }, [query, caretPos]);

  /** Build context-aware suggestions for the current caret position. */
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!acVisible) return [];

    const word = currentWord.toLowerCase();
    const tail = word.includes('.') ? word.split('.')[1] : word;

    // Qualified column form R.x → only R's columns (works in any context).
    if (currentWord.includes('.')) {
      const [rel] = currentWord.split('.');
      const cols = acSchema.colsByRel.get(rel) ?? [];
      return cols
        .filter(c => c.toLowerCase().startsWith(tail))
        .slice(0, 10)
        .map(c => ({ text: c, label: c, hint: rel, kind: 'column' as const }));
    }

    // ----- Context: inside σ ... (condition body) -----
    if (syntaxContext.kind === 'select-cond') {
      const out: Suggestion[] = [];
      const body = syntaxContext.bodyTokens;
      const last = body[body.length - 1];

      if (tail.length > 0) {
        // Mid-word: suggest columns (matching prefix)
        acSchema.allCols
          .filter(c => c.toLowerCase().startsWith(tail))
          .forEach(c => out.push({ text: c, label: c, kind: 'column' }));
        return out.slice(0, 10);
      }
      // Empty current word: decide based on the last token in the condition body.
      if (!last || last.kind === 'LBRACE' || last.kind === 'UNDERSCORE' ||
          last.kind === 'AND' || last.kind === 'OR' || last.kind === 'NOT' || last.kind === 'LPAREN') {
        // Starting a new comparison → expect a column
        acSchema.allCols.slice(0, 8).forEach(c =>
          out.push({ text: c, label: c, kind: 'column', hint: 'columna' }));
        return out;
      }
      if (last.kind === 'IDENT') {
        // Just typed a column → suggest comparison operators
        out.push({ text: '=', label: '=', kind: 'operator', hint: 'igual' });
        out.push({ text: '≠', label: '≠', kind: 'operator', hint: 'distinto' });
        out.push({ text: '<', label: '<', kind: 'operator', hint: 'menor' });
        out.push({ text: '>', label: '>', kind: 'operator', hint: 'mayor' });
        out.push({ text: '≤', label: '≤', kind: 'operator', hint: 'menor o igual' });
        out.push({ text: '≥', label: '≥', kind: 'operator', hint: 'mayor o igual' });
        return out;
      }
      if (['EQ', 'NEQ', 'LT', 'GT', 'LE', 'GE'].includes(last.kind)) {
        // Just typed a cmp op → expect a value or column (right operand)
        acSchema.allCols.slice(0, 8).forEach(c =>
          out.push({ text: c, label: c, kind: 'column', hint: 'columna' }));
        return out;
      }
      if (last.kind === 'STRING' || last.kind === 'NUMBER' || last.kind === 'BOOL' || last.kind === 'RPAREN') {
        // Comparison complete → suggest AND / OR (extend) or the relation arg opener.
        out.push({ text: '∧', label: '∧', kind: 'operator', hint: 'Y lógico (AND)' });
        out.push({ text: '∨', label: '∨', kind: 'operator', hint: 'O lógico (OR)' });
        out.push({ text: '(', label: '(', kind: 'operator', hint: 'abrir relación', pad: 'lparen' });
        return out;
      }
      return out;
    }

    // ----- Context: inside π ... (column list) -----
    if (syntaxContext.kind === 'project-cols') {
      const body = syntaxContext.bodyTokens;
      const last = body[body.length - 1];
      const out: Suggestion[] = [];
      if (tail.length > 0) {
        acSchema.allCols
          .filter(c => c.toLowerCase().startsWith(tail))
          .forEach(c => out.push({ text: c, label: c, kind: 'column' }));
        return out.slice(0, 10);
      }
      if (!last || last.kind === 'LBRACE' || last.kind === 'UNDERSCORE' || last.kind === 'COMMA') {
        acSchema.allCols.slice(0, 10).forEach(c =>
          out.push({ text: c, label: c, kind: 'column', hint: 'columna' }));
        return out;
      }
      if (last.kind === 'IDENT') {
        out.push({ text: ',', label: ',', kind: 'operator', hint: 'agregar otra columna', pad: 'comma' });
        out.push({ text: '(', label: '(', kind: 'operator', hint: 'abrir relación', pad: 'lparen' });
        return out;
      }
      return out;
    }

    // ----- Context: inside ρ ... (alias or column renames) -----
    if (syntaxContext.kind === 'rename-args') {
      const out: Suggestion[] = [];
      const last = syntaxContext.bodyTokens[syntaxContext.bodyTokens.length - 1];
      if (tail.length > 0) {
        acSchema.allCols
          .filter(c => c.toLowerCase().startsWith(tail))
          .forEach(c => out.push({ text: c, label: c, kind: 'column' }));
        return out.slice(0, 10);
      }
      if (last?.kind === 'IDENT') {
        out.push({ text: '→', label: '→', kind: 'operator', hint: 'renombrar a' });
        out.push({ text: '(', label: '(', kind: 'operator', hint: 'abrir relación', pad: 'lparen' });
        return out;
      }
      return out;
    }

    // ----- Default: top-level context -----
    // Find the first non-whitespace char before the word being typed.
    let i = wordStart - 1;
    while (i >= 0 && /\s/.test(query[i])) i--;
    const prev = i >= 0 ? query[i] : '';
    const out: Suggestion[] = [];

    const isFreshSlot = prev === '' || prev === '(' || prev === ',' ||
      ['∪', '∩', '⋈', '⨯', '÷', '−', '-'].includes(prev);

    if (isFreshSlot) {
      acSchema.relations
        .filter(r => r.toLowerCase().startsWith(word))
        .forEach(r => out.push({ text: r, label: r, kind: 'relation' }));
      if (word === '' || 'σπρspr'.includes(word[0])) {
        out.push({ text: 'σ', label: 'σ', kind: 'operator', hint: 'selección' });
        out.push({ text: 'π', label: 'π', kind: 'operator', hint: 'proyección' });
        out.push({ text: 'ρ', label: 'ρ', kind: 'operator', hint: 'renombrar' });
      }
    } else if (prev === ')' || /[a-zA-Z0-9_]/.test(prev)) {
      if (word.length > 0) {
        acSchema.allCols.filter(c => c.toLowerCase().startsWith(word)).forEach(c => out.push({ text: c, label: c, kind: 'column' }));
        acSchema.relations.filter(r => r.toLowerCase().startsWith(word)).forEach(r => out.push({ text: r, label: r, kind: 'relation' }));
      } else {
        out.push({ text: '⋈', label: '⋈', kind: 'operator', hint: 'junta natural' });
        out.push({ text: '⨯', label: '⨯', kind: 'operator', hint: 'producto cartesiano' });
        out.push({ text: '÷', label: '÷', kind: 'operator', hint: 'división' });
        out.push({ text: '∪', label: '∪', kind: 'operator', hint: 'unión' });
        out.push({ text: '∩', label: '∩', kind: 'operator', hint: 'intersección' });
        out.push({ text: '−', label: '−', kind: 'operator', hint: 'diferencia' });
      }
    } else {
      acSchema.allCols.filter(c => c.toLowerCase().startsWith(word)).forEach(c => out.push({ text: c, label: c, kind: 'column' }));
      acSchema.relations.filter(r => r.toLowerCase().startsWith(word)).forEach(r => out.push({ text: r, label: r, kind: 'relation' }));
    }

    return out.slice(0, 10);
  }, [acVisible, currentWord, wordStart, query, acSchema, syntaxContext]);

  // Reset selection index when suggestions list changes
  useEffect(() => { setAcIndex(0); }, [suggestions.length, currentWord]);

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
    const pad: 'name' | 'binary' | 'comma' | 'lparen' | 'punct' = s.pad ??
      (s.kind === 'relation' || s.kind === 'column' ? 'name' : 'binary');

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
        break;
    }

    const insert = (padBefore ? ' ' : '') + s.text + (padAfter ? ' ' : '');
    setQuery(prev => prev.slice(0, wordStart) + insert + prev.slice(caretPos));
    const newCaret = wordStart + insert.length;
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
  const highlightedNodes = useMemo(
    () => highlightQuery(query, { relations: acSchema.relations, columns: acSchema.allCols }),
    [query, acSchema.relations, acSchema.allCols],
  );

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
          <div className="ra-editor-wrap">
            <div ref={highlightRef} className="ra-editor-highlight" aria-hidden>
              {highlightedNodes}
            </div>
          <textarea
            ref={editorRef}
            className="ra-editor"
            value={query}
            onChange={e => { setQuery(e.target.value); setAcVisible(true); }}
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
              // Run query
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                runQuery();
                return;
              }
              // Autocomplete: navigate + accept
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
          <AlgebraPreview query={query} />
          <div className="ra-symbols-bar">
            {SYMBOLS.map(s => (
              <button
                key={s.sym}
                className="ra-symbol-btn"
                title={s.tip}
                onClick={() => insertSymbol(s.sym, s.kind)}
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
            <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
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
            {!error && result && lastProgram && lastTrace.size > 0 && (
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

// CodeMirror 6 editor used exclusively by the SQL tab.
//
// Replaces the textarea + overlay + custom autocomplete with a proper editor
// providing schema-aware completion, syntax highlight, bracket matching,
// multi-cursor, search, etc. The algebra tab keeps its custom textarea
// (Greek-letter overlay, ghost-text, symbol chip-bar) — those features don't
// translate cleanly to CM6 without writing a Lezer grammar for the algebra.
//
// The component is intentionally thin: it owns nothing — value/onChange are
// driven by AlgebraView, and Ctrl+Enter is wired upstream via onRun.

import { useEffect, useMemo, useRef } from 'react';
import type { FC } from 'react';
import CodeMirror, { keymap, EditorView } from '@uiw/react-codemirror';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { sql, SQLite } from '@codemirror/lang-sql';
import { indentUnit, indentOnInput } from '@codemirror/language';
import { indentMore, indentLess, insertNewlineAndIndent } from '@codemirror/commands';
import { autocompletion, startCompletion } from '@codemirror/autocomplete';
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { useSettings } from '../../hooks/useSettings';

export interface SqlEditorSchema {
  /** Table names → ordered list of column names. */
  columnsByTable: Map<string, string[]>;
}

/**
 * Reformat a SQL statement so each major clause starts a fresh line with no
 * leading indent. Conservative formatter — preserves the user's existing
 * spacing inside each clause, only normalises clause boundaries.
 *
 * Rules:
 *   - Major keywords (SELECT, FROM, *JOIN, WHERE, GROUP BY, ORDER BY,
 *     HAVING, LIMIT, UNION/INTERSECT/EXCEPT) start a new line.
 *   - Whitespace runs collapsed to a single space before the boundary work.
 *   - Existing line breaks discarded — the formatter is the single source.
 *   - Empty input returned as-is so the keymap is idempotent.
 */
function formatSqlText(input: string): string {
  if (!input.trim()) return input;
  // Step 1: collapse all whitespace to single spaces so we can splice in
  // our own newlines without leaving double-blank artifacts.
  let s = input.replace(/\s+/g, ' ').trim();
  // Step 2: insert a newline before each major-clause keyword. Word
  // boundaries (\b) + case-insensitive match. We process longest phrases
  // first (e.g. GROUP BY) so the single-word matches don't grab them.
  const patterns: RegExp[] = [
    /\b(?:GROUP\s+BY)\b/gi,
    /\b(?:ORDER\s+BY)\b/gi,
    /\b(?:LEFT|RIGHT|INNER|FULL|CROSS|NATURAL)\s+(?:OUTER\s+)?JOIN\b/gi,
    /\bJOIN\b/gi,
    /\bFROM\b/gi,
    /\bWHERE\b/gi,
    /\bHAVING\b/gi,
    /\bLIMIT\b/gi,
    /\bOFFSET\b/gi,
    /\b(?:UNION(?:\s+ALL)?)\b/gi,
    /\bINTERSECT\b/gi,
    /\bEXCEPT\b/gi,
  ];
  // Use a placeholder for SELECT separately so it stays at the top of the
  // first statement instead of getting a leading newline.
  s = s.replace(/\bSELECT\b/gi, m => '\n' + m);
  for (const re of patterns) {
    s = s.replace(re, m => '\n' + m);
  }
  // Step 3: split statements on ';' so multi-statement scripts each start
  // fresh. Trim each piece and re-join with ';\n\n'.
  s = s
    .split(';')
    .map(stmt => stmt.replace(/^\n+/, '').trim())
    .filter(stmt => stmt.length > 0)
    .join(';\n\n');
  // If the original ended with ';', preserve it.
  if (/;\s*$/.test(input)) s += ';';
  return s;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  schema: SqlEditorSchema;
  /** Fired when the user presses Ctrl/Cmd+Enter. */
  onRun: () => void;
  /** Forwarded to the underlying CodeMirror so the parent can call .focus() etc. */
  editorRef?: React.Ref<ReactCodeMirrorRef>;
}

const SqlEditor: FC<Props> = ({ value, onChange, schema, onRun, editorRef }) => {
  const { settings } = useSettings();
  // CM6's lang-sql takes the schema as an object literal { tableName: [cols] }.
  // Memo dep is schema.columnsByTable (the underlying Map's identity is stable
  // upstream) — NOT `schema` itself, which is a fresh object literal on every
  // render of AlgebraView. Without this, the memo invalidates every keystroke
  // and CM6 reconfigures its extensions, killing the in-flight autocomplete.
  const schemaForCm = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const [t, cols] of schema.columnsByTable.entries()) out[t] = cols;
    return out;
  }, [schema.columnsByTable]);

  // Run-on-Ctrl/Cmd+Enter keymap. `onRun` upstream closes over the current
  // query string, so its identity changes on every keystroke. We funnel it
  // through a ref so the keymap (and therefore the extension array) stays
  // stable — otherwise CM6 reconfigures on each render and the in-flight
  // autocomplete state is torn down.
  const onRunRef = useRef(onRun);
  useEffect(() => { onRunRef.current = onRun; }, [onRun]);
  const runKeymap = useMemo(() =>
    keymap.of([
      {
        key: 'Mod-Enter',
        preventDefault: true,
        run: () => { onRunRef.current(); return true; },
      },
      // Tab → indent the selection (or insert a 2-space indent at the caret).
      // Shift-Tab → dedent. Without this Tab would shift focus out of the
      // editor (the browser default), which is awful for a code editor.
      { key: 'Tab', preventDefault: true, run: indentMore },
      { key: 'Shift-Tab', preventDefault: true, run: indentLess },
      // Enter inserts a newline aligned with the previous line's indent and,
      // when the surrounding syntax suggests it (e.g. just opened a '(' or
      // ended with SELECT/FROM/WHERE), bumps one extra indent. lang-sql ships
      // the rules; this binding just wires Enter to the smart command.
      { key: 'Enter', preventDefault: true, run: insertNewlineAndIndent },
      // Alt+Shift+F → re-format the statement: each major clause on its own
      // line, no leading indent. Same shortcut as VS Code's "Format Document".
      {
        key: 'Alt-Shift-f',
        preventDefault: true,
        run: (view) => {
          const text = view.state.doc.toString();
          const formatted = formatSqlText(text);
          if (formatted === text) return true;
          view.dispatch({
            changes: { from: 0, to: text.length, insert: formatted },
            // Place the caret at the end of the new text — simpler than
            // mapping the old caret through the diff and good enough for
            // a one-shot format command.
            selection: { anchor: formatted.length },
          });
          return true;
        },
      },
    ]),
  []);

  // ── Context-aware completion source ──────────────────────────────────────
  // lang-sql provides keyword highlight + schema awareness, but its built-in
  // completer doesn't fire after a bare space (e.g. "SELECT |"), doesn't
  // include '*' as an option, and treats every keyword the same way.
  //
  // We override with a source that classifies the caret position by the most
  // recent significant token and emits the bucket that fits:
  //   - After SELECT / DISTINCT / a comma in SELECT → '*', columns, aggregates
  //   - After FROM / JOIN / INTO / UPDATE / DELETE FROM → tables
  //   - After WHERE / ON / HAVING / AND / OR / SET → columns
  //   - After GROUP BY / ORDER BY → columns + ASC/DESC where applicable
  //   - Qualified prefix 'alias.' → only that table's columns
  //   - At start of a statement → top-level keywords (SELECT / INSERT / …)
  const sqlCtxCompletion = useMemo(() => {
    // Extract the tables referenced by the current statement (FROM <t> or
    // JOIN <t>, plus aliased forms like "FROM emp e"). Used to narrow the
    // column suggestions in WHERE/ON/HAVING/SET/GROUP BY/ORDER BY so the
    // user only sees columns from the tables actually in the query.
    const tablesInScope = (textBefore: string): string[] => {
      const lastSemi = textBefore.lastIndexOf(';');
      const stmt = lastSemi >= 0 ? textBefore.slice(lastSemi + 1) : textBefore;
      const found = new Set<string>();
      // FROM x or JOIN x  →  capture the first identifier
      const single = /\b(?:FROM|JOIN)\s+([a-zA-Z_]\w*)/gi;
      let m: RegExpExecArray | null;
      while ((m = single.exec(stmt)) !== null) found.add(m[1]);
      // FROM a, b, c — additional tables comma-separated after the first
      // FROM. (Re-runs every match so we catch FROM emp, dept, works.)
      const fromList = /\bFROM\s+([\w\s,]+?)(?=\b(?:WHERE|JOIN|ON|GROUP|ORDER|HAVING|LIMIT|UNION|INTERSECT|EXCEPT|;)\b|$)/gi;
      while ((m = fromList.exec(stmt)) !== null) {
        for (const piece of m[1].split(',')) {
          // Strip optional alias: "emp e" → "emp"
          const name = piece.trim().split(/\s+/)[0];
          if (/^[a-zA-Z_]\w*$/.test(name)) found.add(name);
        }
      }
      // Resolve against the schema (case-insensitive) so user-typed lowercase
      // table names match the canonical casing.
      const lower = new Set(Array.from(found).map(s => s.toLowerCase()));
      return Object.keys(schemaForCm).filter(t => lower.has(t.toLowerCase()));
    };

    return (context: CompletionContext): CompletionResult | null => {
      const word = context.matchBefore(/[\w*.]*/);
      const wordText = word?.text || '';
      const wordFrom = word?.from ?? context.pos;
      const before = context.state.doc.sliceString(0, context.pos);
      // Trim the partial word the user is typing — context detection looks at
      // tokens BEFORE the word, not the prefix itself.
      const beforeWord = before.slice(0, before.length - wordText.length);
      const tail = beforeWord.toUpperCase();

      // Qualified path "alias.col" → restrict to that table's columns
      const qualMatch = wordText.match(/^([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)?$/);
      if (qualMatch) {
        const qual = qualMatch[1];
        const colPrefix = qualMatch[2] ?? '';
        const tableKey = Object.keys(schemaForCm).find(t => t.toLowerCase() === qual.toLowerCase());
        if (tableKey) {
          const opts: Completion[] = schemaForCm[tableKey]
            .filter(c => !colPrefix || c.toLowerCase().startsWith(colPrefix.toLowerCase()))
            .map(c => ({ label: c, type: 'property', detail: tableKey, apply: `${qual}.${c}` }));
          if (opts.length > 0) return { from: wordFrom, options: opts, validFor: /^[\w.]*$/ };
        }
      }

      const ALL_TABLES = Object.keys(schemaForCm);
      const ALL_COLUMNS: { label: string; from: string }[] = [];
      for (const [t, cols] of Object.entries(schemaForCm)) {
        for (const c of cols) ALL_COLUMNS.push({ label: c, from: t });
      }

      // Columns scoped to the FROM/JOIN tables of the current statement.
      // Falls back to ALL_COLUMNS when no FROM has been written yet (so the
      // first SELECT still shows everything).
      const scopedTables = tablesInScope(beforeWord);
      const SCOPED_COLUMNS = scopedTables.length > 0
        ? ALL_COLUMNS.filter(c => scopedTables.some(t => t.toLowerCase() === c.from.toLowerCase()))
        : ALL_COLUMNS;

      // FROM / JOIN / INSERT INTO / DELETE FROM / UPDATE  →  tables
      if (/\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:[\w,]+\s*,\s*)*$/.test(tail) ||
          /\bDELETE\s+FROM\s+$/.test(tail)) {
        const opts: Completion[] = ALL_TABLES.map(t => ({
          label: t,
          type: 'class',
          detail: `tabla · ${schemaForCm[t].length} columnas`,
          boost: 50,
        }));
        return { from: wordFrom, options: opts, validFor: /^[\w]*$/ };
      }

      // SELECT items already typed but no FROM yet → suggest FROM (top of
      // the list) plus more columns / commas in case the user wants to add
      // another item. Triggers when:
      //   - SELECT exists earlier in the statement
      //   - There's no FROM written yet
      //   - The last meaningful char before the caret is '*' or part of an
      //     identifier followed by a space (i.e. an item just finished)
      if (
        /\bSELECT\b/i.test(tail) &&
        !/\bFROM\b/i.test(tail) &&
        /[\w*]\s+$/.test(tail) &&
        // Don't match right after the SELECT keyword itself — that's the
        // bucket below (suggests columns/*, not FROM).
        !/\bSELECT\s+(?:DISTINCT\s+|ALL\s+)?$/i.test(tail)
      ) {
        const opts: Completion[] = [
          { label: 'FROM', type: 'keyword', detail: 'tabla origen', boost: 99 },
          { label: ',', type: 'keyword', detail: 'agregar otra columna', apply: ', ' },
          ...SCOPED_COLUMNS.map(c => ({ label: c.label, type: 'property', detail: c.from })),
        ];
        return { from: wordFrom, options: opts, validFor: /^[\w,]*$/ };
      }

      // SELECT (or after a comma in the SELECT list) → *, scoped columns,
      // aggregates. Columns are filtered to the tables already named in
      // FROM/JOIN when there are any, so multi-statement scripts don't
      // leak unrelated columns into a fresh SELECT.
      if (/\bSELECT\s+(?:DISTINCT\s+|ALL\s+)?(?:[\w*.,\s]*,\s*)?$/.test(tail) ||
          /\bDISTINCT\s+$/.test(tail) || /\bALL\s+$/.test(tail)) {
        const opts: Completion[] = [
          { label: '*', type: 'keyword', detail: 'todas las columnas', boost: 99 },
          { label: 'DISTINCT', type: 'keyword', boost: 80 },
          ...SCOPED_COLUMNS.map(c => ({
            label: c.label,
            type: 'property',
            detail: c.from,
          })),
          ...['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].map(f => ({
            label: f,
            type: 'function',
            detail: 'agregada',
            apply: `${f}()`,
          })),
        ];
        return { from: wordFrom, options: opts, validFor: /^[\w*]*$/ };
      }

      // WHERE / HAVING / ON / AND / OR / NOT / SET → columns of the tables
      // that participate in this statement. e.g. after "SELECT * FROM emp"
      // → only emp.* columns are offered; the dept columns are noise here.
      if (/\b(?:WHERE|HAVING|ON|SET)\s+(?:[\w.=<>!,\s]*\s)?$/.test(tail) ||
          /\b(?:AND|OR|NOT)\s+$/.test(tail)) {
        const opts: Completion[] = SCOPED_COLUMNS.map(c => ({
          label: c.label,
          type: 'property',
          detail: c.from,
        }));
        return { from: wordFrom, options: opts, validFor: /^[\w.]*$/ };
      }

      // GROUP BY / ORDER BY → scoped columns (+ ASC/DESC for ORDER BY)
      if (/\bGROUP\s+BY\s+(?:[\w,\s]*,\s*)?$/.test(tail)) {
        const opts: Completion[] = SCOPED_COLUMNS.map(c => ({
          label: c.label,
          type: 'property',
          detail: c.from,
        }));
        return { from: wordFrom, options: opts, validFor: /^[\w]*$/ };
      }
      if (/\bORDER\s+BY\s+(?:[\w,\s]*,\s*)?$/.test(tail)) {
        const opts: Completion[] = [
          ...SCOPED_COLUMNS.map(c => ({ label: c.label, type: 'property', detail: c.from })),
          { label: 'ASC', type: 'keyword' },
          { label: 'DESC', type: 'keyword' },
        ];
        return { from: wordFrom, options: opts, validFor: /^[\w]*$/ };
      }

      // Start of statement → top-level DML/DDL keywords
      if (/(?:^|;|\)\s*)\s*$/.test(beforeWord)) {
        const opts: Completion[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'WITH']
          .map(k => ({ label: k, type: 'keyword' }));
        return { from: wordFrom, options: opts, validFor: /^[\w]*$/ };
      }

      return null;
    };
  }, [schemaForCm]);

  // After the user types a space, the partial-word prefix is empty so CM6
  // doesn't trigger autocomplete by itself. If the space follows a SQL
  // keyword that has a well-defined "next" bucket (SELECT, FROM, WHERE, …),
  // we manually call startCompletion so the dropdown opens immediately.
  const triggerOnSpace = useMemo(() =>
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      let typedSpace = false;
      for (const tr of update.transactions) {
        tr.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => {
          if (inserted.toString() === ' ') typedSpace = true;
        });
      }
      if (!typedSpace) return;
      const pos = update.state.selection.main.head;
      const before = update.state.doc.sliceString(Math.max(0, pos - 40), pos);
      const isTrigger =
        /\b(SELECT|DISTINCT|ALL|FROM|JOIN|ON|WHERE|HAVING|AND|OR|NOT|SET|VALUES|INTO|UPDATE|GROUP\s+BY|ORDER\s+BY|BY|UNION|EXCEPT|INTERSECT)\s+$/i.test(before) ||
        /,\s+$/.test(before) ||
        // After SELECT items but before FROM: user typed '*' or a column
        // and pressed space — surface FROM as the next obvious step.
        (/\bSELECT\b/i.test(before) && !/\bFROM\b/i.test(before) && /[\w*]\s+$/.test(before));
      if (!isTrigger) return;
      // Defer to next frame so the space change is committed before the
      // completion query reads the document.
      setTimeout(() => startCompletion(update.view), 0);
    }),
  []);

  const extensions = useMemo(() => [
    sql({
      dialect: SQLite,
      schema: schemaForCm,
      upperCaseKeywords: true,
    }),
    // Override the default SQL completer with our context-aware one. We lose
    // lang-sql's built-in completion source (which is mostly redundant with
    // ours), but keep its syntax highlighting + indent rules — those come
    // through the language extension, not the completer.
    autocompletion({
      override: [sqlCtxCompletion],
      activateOnTyping: true,
      closeOnBlur: true,
    }),
    triggerOnSpace,
    // Use two spaces — soft tab — so the formatted output is consistent
    // regardless of the user's tab-width setting. Combined with the Tab
    // keybinding above (indentMore) this gives us the conventional
    // "Tab to indent, Shift-Tab to dedent" UX.
    indentUnit.of('  '),
    // Trigger re-indent while typing — when the user finishes a structural
    // token (e.g. closes a paren or types a keyword), the line gets
    // re-aligned automatically based on the SQL grammar.
    indentOnInput(),
    runKeymap,
  ], [schemaForCm, runKeymap, sqlCtxCompletion, triggerOnSpace]);

  // CodeMirror only applies its `theme` prop on first mount — subsequent
  // changes are ignored. Keying the component by the current theme forces
  // React to remount when the user toggles ☀/☾, which is fine for an
  // editor whose only "lost" state on remount is undo history (and the
  // value lives in our parent React state anyway).
  return (
    <CodeMirror
      key={settings.theme}
      ref={editorRef}
      value={value}
      onChange={onChange}
      extensions={extensions}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightSelectionMatches: true,
        autocompletion: true,
        closeBrackets: true,
        bracketMatching: true,
        // Smart re-indent on input AND tabSize 2 for visual alignment.
        // The actual indent unit (2 spaces) is enforced by indentUnit
        // above; tabSize here is only how wide a literal '\t' renders.
        indentOnInput: true,
        tabSize: 2,
      }}
      // Inline style + class lets the parent's flex layout still drive size.
      className="ra-cm-editor"
      height="100%"
      style={{ height: '100%', fontSize: '0.9rem' }}
      theme={settings.theme === 'dark' ? 'dark' : 'light'}
      placeholder="-- Escribí SQL · Ctrl+Enter para ejecutar"
    />
  );
};

export default SqlEditor;

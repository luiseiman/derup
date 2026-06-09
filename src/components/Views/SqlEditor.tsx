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
import CodeMirror, { keymap } from '@uiw/react-codemirror';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { sql, SQLite } from '@codemirror/lang-sql';
import { indentUnit, indentOnInput } from '@codemirror/language';
import { indentMore, indentLess, insertNewlineAndIndent } from '@codemirror/commands';
import { useSettings } from '../../hooks/useSettings';

export interface SqlEditorSchema {
  /** Table names → ordered list of column names. */
  columnsByTable: Map<string, string[]>;
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
    ]),
  []);

  const extensions = useMemo(() => [
    sql({
      dialect: SQLite,
      schema: schemaForCm,
      upperCaseKeywords: true,
    }),
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
  ], [schemaForCm, runKeymap]);

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

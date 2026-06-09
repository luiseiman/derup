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

import { useMemo } from 'react';
import type { FC } from 'react';
import CodeMirror, { keymap } from '@uiw/react-codemirror';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { sql, SQLite } from '@codemirror/lang-sql';

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
  // CM6's lang-sql takes the schema as an object literal { tableName: [cols] }.
  // We build it from our Map. Memoised so it doesn't churn when the parent
  // re-renders for unrelated reasons.
  const schemaForCm = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const [t, cols] of schema.columnsByTable.entries()) out[t] = cols;
    return out;
  }, [schema]);

  // Run-on-Ctrl/Cmd+Enter keymap. Returning `true` tells CM6 the key was
  // handled so its default ("insert newline") doesn't also fire.
  const runKeymap = useMemo(() =>
    keymap.of([{
      key: 'Mod-Enter',
      preventDefault: true,
      run: () => { onRun(); return true; },
    }]),
  [onRun]);

  const extensions = useMemo(() => [
    sql({
      dialect: SQLite,
      schema: schemaForCm,
      upperCaseKeywords: true,
    }),
    runKeymap,
  ], [schemaForCm, runKeymap]);

  return (
    <CodeMirror
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
        indentOnInput: false,
        tabSize: 2,
      }}
      // Inline style + class lets the parent's flex layout still drive size.
      className="ra-cm-editor"
      height="100%"
      style={{ height: '100%', fontSize: '0.9rem' }}
      theme="light"
      placeholder="-- Escribí SQL · Ctrl+Enter para ejecutar"
    />
  );
};

export default SqlEditor;

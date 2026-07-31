import { useEffect, useRef } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { sql, PostgreSQL, keywordCompletionSource } from '@codemirror/lang-sql'
import { autocompletion, acceptCompletion } from '@codemirror/autocomplete'
import { basicSetup } from 'codemirror'
import { editorThemeExtension } from '../query/editor-themes'
import { schemaCompletionSource } from '../query/completion'
import { useThemeStore } from '../store-theme'

export function SqlEditor(props: {
  value: string
  onChange: (v: string) => void
  onRun: () => void
  connectionId: string | null
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartment = useRef(new Compartment())
  const effective = useThemeStore((s) => s.effective)
  const effectiveRef = useRef(effective)
  effectiveRef.current = effective
  const editorTheme = useThemeStore((s) => s.editorTheme)
  const editorThemeRef = useRef(editorTheme)
  editorThemeRef.current = editorTheme
  const onChangeRef = useRef(props.onChange)
  const onRunRef = useRef(props.onRun)
  onChangeRef.current = props.onChange
  onRunRef.current = props.onRun

  useEffect(() => {
    if (!host.current) return
    const connId = props.connectionId
    const state = EditorState.create({
      doc: props.value,
      extensions: [
        basicSetup,
        // The theme lives entirely in the compartment so a packaged scheme
        // (Monokai etc.) fully replaces the app-token surfaces rather than
        // layering over them.
        themeCompartment.current.of(
          editorThemeExtension(editorThemeRef.current, effectiveRef.current)
        ),
        sql({ dialect: PostgreSQL, upperCaseKeywords: true }),
        autocompletion(
          connId
            ? {
                override: [
                  keywordCompletionSource(PostgreSQL, true),
                  schemaCompletionSource(connId)
                ]
              }
            : {}
        ),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              onRunRef.current()
              return true
            }
          },
          // Tab: accept the open completion, else indent. CodeMirror leaves Tab
          // unbound by default so it moves focus, which is the accessible
          // default but wrong for a SQL editor — Tab did nothing to the
          // suggestion list and jumped to the next control instead.
          //
          // Binding Tab traps it, so Escape-then-Tab is the way out; that is
          // the documented CodeMirror escape hatch and matches what code
          // editors do.
          { key: 'Tab', run: acceptCompletion },
          indentWithTab,
          ...defaultKeymap
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString())
        })
      ]
    })
    const view = new EditorView({ state, parent: host.current })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Recreate on connection change so the schema is rebound. value is the
    // initial doc only (CodeMirror owns the doc after mount).
  }, [props.connectionId])

  // Swap the whole editor theme (surfaces + syntax palette) when the app theme
  // flips or the user picks a different editor scheme — reconfigure the
  // compartment in place (no remount, doc/selection preserved).
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.current.reconfigure(editorThemeExtension(editorTheme, effective))
    })
  }, [effective, editorTheme])

  // Reconcile external value changes (Format, load from history/saved) that the
  // editor didn't originate. A programmatic replace re-fires onChange with the
  // same string, so props.value converges and this won't loop.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (props.value !== current)
      view.dispatch({ changes: { from: 0, to: current.length, insert: props.value } })
  }, [props.value])

  return <div ref={host} className="h-full overflow-auto border border-border rounded" />
}

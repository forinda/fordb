import { useEffect, useRef } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import { sql, PostgreSQL } from '@codemirror/lang-sql'
import { autocompletion } from '@codemirror/autocomplete'
import { basicSetup } from 'codemirror'
import { cmTheme, editorHighlight } from '../query/cm-theme'
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
        cmTheme,
        themeCompartment.current.of(editorHighlight(effectiveRef.current)),
        sql({ dialect: PostgreSQL, upperCaseKeywords: true }),
        autocompletion(connId ? { override: [schemaCompletionSource(connId)] } : {}),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              onRunRef.current()
              return true
            }
          },
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

  // Swap the syntax palette when the app theme flips — reconfigure the
  // compartment in place (no remount, doc/selection preserved).
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.current.reconfigure(editorHighlight(effective))
    })
  }, [effective])

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

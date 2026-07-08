import { useEffect, useRef } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import { sql, PostgreSQL } from '@codemirror/lang-sql'
import { autocompletion } from '@codemirror/autocomplete'
import { basicSetup } from 'codemirror'
import { cmTheme } from '../query/cm-theme'
import { schemaCompletionSource } from '../query/completion'

export function SqlEditor(props: {
  value: string
  onChange: (v: string) => void
  onRun: () => void
  connectionId: string | null
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
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
    return () => view.destroy()
    // Recreate on connection change so the schema is rebound. value is the
    // initial doc only (CodeMirror owns the doc after mount).
  }, [props.connectionId])

  return <div ref={host} className="h-full overflow-auto border border-border rounded" />
}

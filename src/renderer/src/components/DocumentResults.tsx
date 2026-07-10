import { useEffect, useRef, useState } from 'react'
import JsonView from '@uiw/react-json-view'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { basicSetup } from 'codemirror'
import type { DocumentResultSource } from '../query/documents'
import { useDocumentMutatorSupported } from '../query/documents'
import { useConnStore } from '../store'
import { useQueryStore } from '../store-query'
import { parseRelaxed } from '@shared/mongo/relaxed-json'
import { buildUpdatePatch } from '@shared/mongo/patch-diff'
import { cmTheme, editorHighlight } from '../query/cm-theme'
import { useThemeStore } from '../store-theme'
import { Button } from './ui/button'

type ViewMode = 'tree' | 'raw'

function parseDocInput(text: string): Record<string, unknown> {
  const value = parseRelaxed(text) // throws → caller catches and surfaces the message
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Document must be a JSON object')
  return value as Record<string, unknown>
}

/** Uncontrolled JSON-mode CodeMirror editor, short-lived (mounted only while a
 *  card is in edit mode / the insert panel is open). Mirrors the doc-query
 *  tab's DocEditor setup (QueryWorkbench.tsx) minus the Mod-Enter run binding
 *  and live theme-swap compartment — this editor is torn down on
 *  save/cancel, so it only needs to render correctly for the theme active at
 *  mount. */
function JsonEditor(props: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const effective = useThemeStore((s) => s.effective)
  const onChangeRef = useRef(props.onChange)
  onChangeRef.current = props.onChange

  useEffect(() => {
    if (!host.current) return
    const state = EditorState.create({
      doc: props.value,
      extensions: [
        basicSetup,
        cmTheme,
        editorHighlight(effective),
        json(),
        keymap.of(defaultKeymap),
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
    // Mount once — each edit/insert session gets a fresh instance (unmounted on
    // close), so there's no need to reconcile external value changes here.
  }, [])

  return <div className="max-h-72 overflow-auto rounded border border-border" ref={host} />
}

function DocumentCard(props: {
  doc: Record<string, unknown>
  tabId: string
  mutatorSupported: boolean
}): React.JSX.Element {
  const { doc, tabId, mutatorSupported } = props
  const [mode, setMode] = useState<ViewMode>('tree')
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const updateDoc = useQueryStore((s) => s.updateDoc)
  const deleteDoc = useQueryStore((s) => s.deleteDoc)

  function startEdit(): void {
    setError(null)
    setNotice(null)
    setEditText(JSON.stringify(doc, null, 2))
    setEditing(true)
  }

  function cancelEdit(): void {
    setEditing(false)
    setError(null)
  }

  async function save(): Promise<void> {
    setError(null)
    let edited: Record<string, unknown>
    try {
      edited = parseDocInput(editText)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return
    }
    if ('_id' in edited && JSON.stringify(edited._id) !== JSON.stringify(doc._id)) {
      setError('Cannot change _id')
      return
    }
    // An empty $set is a silent no-op on the server — short-circuit instead of
    // sending it, per the T9 review carry-over.
    const patch = buildUpdatePatch(doc, edited)
    if (patch === null) {
      setEditing(false)
      setNotice('No changes — nothing saved.')
      setTimeout(() => setNotice(null), 2500)
      return
    }
    const ok = window.confirm(`Apply this $set patch?\n\n${JSON.stringify(patch, null, 2)}`)
    if (!ok) return
    try {
      await updateDoc(tabId, doc._id, patch)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function remove(): Promise<void> {
    setError(null)
    const ok = window.confirm(`Delete document ${JSON.stringify(doc._id)}?`)
    if (!ok) return
    try {
      await deleteDoc(tabId, doc._id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="group rounded-xl border border-border bg-card p-2.5 shadow-[var(--shadow-raised)] hover:border-border-strong">
      <div className="mb-1 flex gap-1">
        <Button
          size="sm"
          variant={mode === 'tree' ? 'default' : 'outline'}
          onClick={() => setMode('tree')}
        >
          Tree
        </Button>
        <Button
          size="sm"
          variant={mode === 'raw' ? 'default' : 'outline'}
          onClick={() => setMode('raw')}
        >
          Raw
        </Button>
        {mutatorSupported && !editing && (
          <>
            <Button size="sm" variant="outline" className="ml-auto" onClick={startEdit}>
              Edit
            </Button>
            <Button size="sm" variant="outline" onClick={() => void remove()}>
              Delete
            </Button>
          </>
        )}
      </div>
      {notice && <div className="mb-1 text-xs text-muted-foreground">{notice}</div>}
      {error && <div className="mb-1 text-xs text-destructive">{error}</div>}
      {editing ? (
        <div className="flex flex-col gap-1">
          <JsonEditor value={editText} onChange={setEditText} />
          <div className="flex gap-1">
            <Button size="sm" onClick={() => void save()}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit}>
              Cancel
            </Button>
          </div>
        </div>
      ) : mode === 'tree' ? (
        <JsonView value={doc} />
      ) : (
        <pre className="overflow-auto font-mono text-xs leading-5 text-foreground-soft">
          {JSON.stringify(doc, null, 2)}
        </pre>
      )}
    </div>
  )
}

function InsertPanel(props: { tabId: string; onClose: () => void }): React.JSX.Element {
  const insertDoc = useQueryStore((s) => s.insertDoc)
  const [text, setText] = useState('{\n  \n}')
  const [error, setError] = useState<string | null>(null)

  async function handleInsert(): Promise<void> {
    setError(null)
    let doc: Record<string, unknown>
    try {
      doc = parseDocInput(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return
    }
    try {
      await insertDoc(props.tabId, doc)
      props.onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="mb-2 rounded-xl border border-primary/40 bg-card p-2.5 shadow-[var(--shadow-raised)]">
      {error && <div className="mb-1 text-xs text-destructive">{error}</div>}
      <JsonEditor value={text} onChange={setText} />
      <div className="mt-1 flex gap-1">
        <Button size="sm" onClick={() => void handleInsert()}>
          Insert
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** Scrollable list of a document-mode run's results. Each document is a card
 *  with a per-card Tree/Raw toggle. `source.docs`/`source.done` are read LIVE
 *  each render (mutated in place by loadMore()) — `tick` mirrors the
 *  ResultsGrid live-count pattern, forcing a re-render once a background page
 *  resolves. When `documentMutatorSupported`, each card additionally gets
 *  Edit/Delete, and a collection-level "+ Insert document" affordance appears
 *  above the list. */
export function DocumentResults(props: {
  source: DocumentResultSource
  tabId: string
  elapsedMs?: number
}): React.JSX.Element {
  const { source, tabId } = props
  const [, setTick] = useState(0)
  const [loading, setLoading] = useState(false)
  const [inserting, setInserting] = useState(false)
  const connId = useConnStore((s) => s.activeConnectionId)
  const mutatorSupported = useDocumentMutatorSupported(connId).data ?? false

  async function handleLoadMore(): Promise<void> {
    if (loading || source.done) return
    setLoading(true)
    try {
      await source.loadMore()
    } finally {
      setLoading(false)
      setTick((t) => t + 1)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto bg-surface-2 p-3">
        {mutatorSupported && (
          <div className="mb-2">
            {inserting ? (
              <InsertPanel tabId={tabId} onClose={() => setInserting(false)} />
            ) : (
              <Button size="sm" variant="outline" onClick={() => setInserting(true)}>
                + Insert document
              </Button>
            )}
          </div>
        )}
        {source.docs.length === 0 ? (
          <div className="text-muted-foreground">No documents.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {source.docs.map((doc, i) => (
              <DocumentCard key={i} doc={doc} tabId={tabId} mutatorSupported={mutatorSupported} />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-border p-2 text-sm text-muted-foreground">
        {!source.done && (
          <Button size="sm" onClick={() => void handleLoadMore()} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        )}
        <span className="ml-auto">
          {source.docs.length} document{source.docs.length === 1 ? '' : 's'}
          {source.done ? '' : '+'}
          {props.elapsedMs !== undefined ? ` · ${Math.round(props.elapsedMs)}ms` : ''}
        </span>
      </div>
    </div>
  )
}

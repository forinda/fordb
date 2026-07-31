import { useEffect, useRef, useState } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { basicSetup } from 'codemirror'
import { useQueryStore, type QueryTab } from '../store-query'
import { SqlEditor } from './SqlEditor'
import { ResultsGrid } from './ResultsGrid'
import { DocumentResults } from './DocumentResults'
import { TableDataGrid } from './TableDataGrid'
import { StructureView } from './StructureView'
import { ExplainView } from './ExplainView'
import { ObjectDefinitionView } from './ObjectDefinitionView'
import { QueryTabs } from './QueryTabs'
import { useIndexes } from '../query/introspection'
import { useConnStore } from '../store'
import IconPlay from '~icons/lucide/play'
import IconX from '~icons/lucide/x'
import IconAlignLeft from '~icons/lucide/align-left'
import IconSearch from '~icons/lucide/search'
import IconSave from '~icons/lucide/save'
import IconBookmark from '~icons/lucide/bookmark'
import IconClock from '~icons/lucide/clock'
import IconDownload from '~icons/lucide/download'
import IconSearchCode from '~icons/lucide/search-code'
import IconBraces from '~icons/lucide/braces'
import IconPanelTop from '~icons/lucide/panel-top'
import IconPanelBottom from '~icons/lucide/panel-bottom'
import { useDialect } from '../query/use-dialect'
import { Button } from './ui/button'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './ui/resizable'
import { stringifyCsv } from '@shared/csv/csv'
import { editorThemeExtension } from '../query/editor-themes'
import { useThemeStore } from '../store-theme'
import { useDocumentQuerySupported } from '../query/documents'

const cellStr = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

/** JSON-mode CodeMirror editor for a document-mode tab's find/aggregate text.
 *  Mirrors SqlEditor's setup (uncontrolled doc, Mod-Enter runs), swapped to
 *  the json() language and without SQL schema completion. */
function DocEditor(props: {
  value: string
  onChange: (v: string) => void
  onRun: () => void
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartment = useRef(new Compartment())
  const effective = useThemeStore((s) => s.effective)
  const editorTheme = useThemeStore((s) => s.editorTheme)
  const onChangeRef = useRef(props.onChange)
  const onRunRef = useRef(props.onRun)
  onChangeRef.current = props.onChange
  onRunRef.current = props.onRun

  useEffect(() => {
    if (!host.current) return
    const state = EditorState.create({
      doc: props.value,
      extensions: [
        basicSetup,
        themeCompartment.current.of(editorThemeExtension(editorTheme, effective)),
        json(),
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
    // Mount once — the editor is uncontrolled after creation (see the
    // reconciliation effect below); there's no connection to rebind against
    // like SqlEditor's schema-aware completion.
  }, [])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.current.reconfigure(editorThemeExtension(editorTheme, effective))
    })
  }, [effective, editorTheme])

  // Reconcile external value changes (mode toggle doesn't touch text, but a
  // future "load into editor" affordance could) that the editor didn't
  // originate. A programmatic replace re-fires onChange with the same string,
  // so props.value converges and this won't loop.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (props.value !== current)
      view.dispatch({ changes: { from: 0, to: current.length, insert: props.value } })
  }, [props.value])

  return <div ref={host} className="h-full overflow-auto border border-border rounded" />
}

function DocumentWorkbench(props: { tab: QueryTab }): React.JSX.Element {
  const { tab } = props
  const doc = tab.doc!
  const setDoc = useQueryStore((s) => s.setDoc)
  const run = useQueryStore((s) => s.run)
  const explainDoc = useQueryStore((s) => s.explainDoc)
  const exportDocs = useQueryStore((s) => s.exportDocs)
  // Indexes side panel (Dialect Mongo view). The collection lives in the
  // profile's default database — that's what documentQuery targets too.
  const [showIndexes, setShowIndexes] = useState(false)
  const connId = useConnStore((s) => s.activeConnectionId)
  // Indexes target the collection's OWN database (from the tab), not the
  // connection default — same fix as the query/mutator path.
  const indexesQ = useIndexes(
    connId,
    showIndexes ? doc.database : null,
    showIndexes ? doc.collection : null
  )

  return (
    <div className="flex flex-col h-full">
      <QueryTabs />
      <div className="flex items-center gap-2 overflow-x-auto border-b border-border p-2 [&>*]:shrink-0">
        <span className="text-sm text-muted-foreground">Collection</span>
        <span className="font-mono text-sm text-foreground">
          {doc.database}.{doc.collection}
        </span>
        <div className="flex rounded border border-border overflow-hidden">
          <Button
            size="sm"
            variant={doc.mode === 'find' ? 'default' : 'ghost'}
            className="rounded-none"
            onClick={() => setDoc(tab.id, { mode: 'find' })}
          >
            find
          </Button>
          <Button
            size="sm"
            variant={doc.mode === 'aggregate' ? 'default' : 'ghost'}
            className="rounded-none"
            onClick={() => setDoc(tab.id, { mode: 'aggregate' })}
          >
            aggregate
          </Button>
          <Button
            size="sm"
            variant={doc.mode === 'bulk' ? 'default' : 'ghost'}
            className="rounded-none"
            onClick={() => setDoc(tab.id, { mode: 'bulk', bulkOp: doc.bulkOp ?? 'update' })}
          >
            bulk
          </Button>
        </div>
        {doc.database && (
          <Button
            size="sm"
            variant={showIndexes ? 'default' : 'ghost'}
            onClick={() => setShowIndexes((v) => !v)}
          >
            Indexes
          </Button>
        )}
        {doc.mode !== 'bulk' && (
          <>
            <Button onClick={() => void run(tab.id)} disabled={tab.status === 'running'}>
              Run
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void explainDoc(tab.id)}
              disabled={tab.status === 'running'}
            >
              Explain
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void exportDocs(tab.id, 'json')}>
              Export JSON
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void exportDocs(tab.id, 'ndjson')}>
              Export NDJSON
            </Button>
          </>
        )}
        <span className="text-sm text-muted-foreground ml-auto">
          {tab.status === 'running' && 'running…'}
          {tab.status === 'error' && <span className="text-destructive">{tab.message}</span>}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="vertical">
          <ResizablePanel defaultSize={40} minSize={20}>
            <div className="h-full min-h-0">
              <DocEditor
                key={tab.id}
                value={doc.text}
                onChange={(v) => setDoc(tab.id, { text: v })}
                onRun={() => void run(tab.id)}
              />
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel minSize={20}>
            <div className="h-full min-h-0 overflow-auto">
              {doc.mode === 'bulk' ? (
                <BulkPanel tab={tab} />
              ) : tab.docSource ? (
                <>
                  {showIndexes && (
                    <div className="border-b border-border-soft bg-surface-1 px-3 py-2">
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Indexes
                      </div>
                      <div className="flex flex-col gap-1">
                        {(indexesQ.data ?? []).map((ix) => (
                          <div key={ix.name} className="flex items-center gap-2 text-xs">
                            <span className="font-mono text-foreground-soft">{ix.name}</span>
                            <span className="text-faint">{ix.columns.join(', ')}</span>
                            {ix.unique && (
                              <span className="rounded bg-info/15 px-1 text-[10px] font-semibold uppercase text-info">
                                unique
                              </span>
                            )}
                          </div>
                        ))}
                        {indexesQ.data?.length === 0 && (
                          <span className="text-xs text-muted-foreground">No indexes.</span>
                        )}
                      </div>
                    </div>
                  )}
                  <DocumentResults
                    source={tab.docSource}
                    tabId={tab.id}
                    elapsedMs={tab.elapsedMs}
                  />
                </>
              ) : (
                <div className="p-4 text-muted-foreground">Run a query to see results.</div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}

function BulkPanel(props: { tab: QueryTab }): React.JSX.Element {
  const { tab } = props
  const doc = tab.doc!
  const setDoc = useQueryStore((s) => s.setDoc)
  const bulkCount = useQueryStore((s) => s.bulkCount)
  const bulkApply = useQueryStore((s) => s.bulkApply)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const op = doc.bulkOp ?? 'update'

  async function preview(): Promise<void> {
    setBusy(true)
    setMsg('')
    try {
      setMsg(`Matches ${await bulkCount(tab.id)} document(s)`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function apply(): Promise<void> {
    setBusy(true)
    setMsg('')
    try {
      const count = await bulkCount(tab.id)
      const emptyFilter = doc.text.trim() === '' || doc.text.trim() === '{}'
      const warn =
        op === 'delete' && emptyFilter
          ? '\n\nWARNING: an empty filter deletes EVERY document in the collection.'
          : ''
      const verb = op === 'delete' ? 'Delete' : 'Update'
      if (
        !window.confirm(`${verb} ${count} document(s) in ${doc.database}.${doc.collection}?${warn}`)
      )
        return
      setMsg(await bulkApply(tab.id))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <div className="text-xs text-muted-foreground">
        The editor above is the <span className="font-mono">filter</span> (which documents to
        match).
      </div>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">Operation</span>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={op === 'update'}
            onChange={() => setDoc(tab.id, { bulkOp: 'update' })}
          />
          updateMany
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={op === 'delete'}
            onChange={() => setDoc(tab.id, { bulkOp: 'delete' })}
          />
          deleteMany
        </label>
      </div>
      {op === 'update' && (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">
            Update document (e.g. <span className="font-mono">{'{ "$set": { "x": 1 } }'}</span>)
          </div>
          <div className="h-32 rounded border border-border">
            <DocEditor
              key={`${tab.id}:update`}
              value={doc.updateText ?? '{ "$set": {} }'}
              onChange={(v) => setDoc(tab.id, { updateText: v })}
              onRun={() => void apply()}
            />
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => void preview()} disabled={busy}>
          Preview count
        </Button>
        <Button size="sm" onClick={() => void apply()} disabled={busy}>
          Apply
        </Button>
        {msg && <span className="text-muted-foreground">{msg}</span>}
      </div>
    </div>
  )
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function QueryWorkbench(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  const tabs = useQueryStore((s) => s.tabs)
  const activeId = useQueryStore((s) => s.activeTabId)
  const newTab = useQueryStore((s) => s.newTab)
  const setSql = useQueryStore((s) => s.setSql)
  const run = useQueryStore((s) => s.run)
  const cancel = useQueryStore((s) => s.cancel)
  const formatActive = useQueryStore((s) => s.formatActive)
  const openExplain = useQueryStore((s) => s.openExplain)
  const setPicker = useQueryStore((s) => s.setPicker)
  // Panel visibility: collapse the editor or results pane to give the other
  // the full height (Dialect: controls to get panels out of the way).
  const [showEditorPane, setShowEditorPane] = useState(true)
  const [showResultsPane, setShowResultsPane] = useState(true)
  const { dialect, sqlLang } = useDialect()
  const docSupported = useDocumentQuerySupported(connId).data ?? false
  const tab = tabs.find((t) => t.id === activeId)

  useEffect(() => {
    if (tabs.length === 0) newTab()
  }, [tabs.length, newTab])

  if (!tab) return <div className="p-4 text-muted-foreground">No query tab.</div>

  async function exportData(kind: 'csv' | 'json', basename = 'result'): Promise<void> {
    const src = tab!.source
    if (!src) return
    await src.drainAll()
    const names = src.fields.map((f) => f.name)
    const rows = Array.from({ length: src.loadedRowCount() }, (_, i) => src.getRow(i) ?? [])
    if (kind === 'csv')
      download(
        `${basename}.csv`,
        stringifyCsv([names, ...rows.map((r) => r.map(cellStr))]),
        'text/csv'
      )
    else
      download(
        `${basename}.json`,
        JSON.stringify(
          rows.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i]]))),
          null,
          2
        ),
        'application/json'
      )
  }

  // Export the browse grid's current filtered/sorted rows. Draining an entire
  // unfiltered table pulls every row into memory — warn on that one case.
  async function exportBrowse(kind: 'csv' | 'json'): Promise<void> {
    const d = tab!.data
    if (
      d &&
      d.browse.filters.length === 0 &&
      !window.confirm(`Export the entire "${d.table}" table? This fetches all rows.`)
    )
      return
    await exportData(kind, d?.table ?? 'table')
  }

  if (tab.kind === 'data') {
    return (
      <div className="flex flex-col h-full">
        <QueryTabs />
        <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-xs">
          <span className="text-muted-foreground">Export{tab.data && ' ' + tab.data.table}:</span>
          <button
            className="rounded border border-border px-2 py-0.5 hover:bg-surface-2"
            disabled={!tab.source}
            onClick={() => void exportBrowse('csv')}
          >
            CSV
          </button>
          <button
            className="rounded border border-border px-2 py-0.5 hover:bg-surface-2"
            disabled={!tab.source}
            onClick={() => void exportBrowse('json')}
          >
            JSON
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <TableDataGrid key={tab.id} tab={tab} />
        </div>
      </div>
    )
  }

  if (tab.kind === 'structure') {
    return (
      <div className="flex flex-col h-full">
        <QueryTabs />
        <div className="min-h-0 flex-1">
          <StructureView key={tab.id} tab={tab} />
        </div>
      </div>
    )
  }

  if (tab.kind === 'explain') {
    return (
      <div className="flex flex-col h-full">
        <QueryTabs />
        <div className="min-h-0 flex-1">
          <ExplainView key={tab.id} tab={tab} />
        </div>
      </div>
    )
  }

  if (tab.kind === 'object') {
    return (
      <div className="flex flex-col h-full">
        <QueryTabs />
        <div className="min-h-0 flex-1">
          <ObjectDefinitionView key={tab.id} tab={tab} />
        </div>
      </div>
    )
  }

  // Document-mode query tab (MongoDB collection opened from the tree, or a
  // find/aggregate tab): a JSON editor + mode toggle + DocumentResults,
  // instead of the SQL editor/grid below. Relational query tabs (no `doc`)
  // fall through unchanged.
  if (tab.doc) return <DocumentWorkbench key={tab.id} tab={tab} />

  // Document-mode (MongoDB) connection but the tab is a plain default tab
  // (no doc attached yet — that only happens via openCollection). The SQL
  // workbench and its toolbar (Run/Explain/Export/Save/History) don't apply
  // to Mongo; show a hint to use the sidebar instead of a dead SQL editor.
  if (docSupported) {
    return (
      <div className="flex flex-col h-full">
        <QueryTabs />
        <div className="flex-1 min-h-0 flex items-center justify-center p-4">
          <p className="text-muted-foreground text-center max-w-sm">
            Select a collection from the sidebar to query documents.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <QueryTabs />
      {/* One row, grouped by purpose: primary action · authoring · library ·
          export · pane layout. Everything but Run is icon-only; each keeps its
          exact accessible name, so `getByRole('button', { name })` still
          reaches it. The result summary that used to sit on the right is gone —
          the status bar already renders it. */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-surface-1 px-2 py-1.5 [&>*]:shrink-0">
        {/* Run and Cancel were mutually exclusive states of one action drawn as
            two buttons, one of which was always dead. Now it is one that swaps. */}
        {tab.status === 'running' ? (
          <button
            className="flex items-center gap-1.5 rounded bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void cancel(tab.id)}
          >
            <IconX className="h-3 w-3" />
            <span>Stop</span>
          </button>
        ) : (
          <button
            className="flex items-center gap-1.5 rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void run(tab.id)}
          >
            <IconPlay className="h-3 w-3" />
            {/* Own span so getByText('Run', {exact:true}) still resolves (e2e). */}
            <span>Run</span>
            <span className="text-[10px] opacity-70">
              {window.fordb.platform === 'darwin' ? '⌘⏎' : 'Ctrl ⏎'}
            </span>
          </button>
        )}

        <Divider />
        <IconButton label="Format" onClick={() => formatActive(sqlLang)} disabled={!tab.sql.trim()}>
          <IconAlignLeft className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          label="Explain"
          onClick={() => void openExplain(dialect, false)}
          disabled={!tab.sql.trim()}
        >
          <IconSearch className="h-3.5 w-3.5" />
        </IconButton>
        {dialect === 'pg' && (
          <IconButton
            label="Explain analyze"
            onClick={() => void openExplain(dialect, true)}
            disabled={!tab.sql.trim()}
          >
            <IconSearchCode className="h-3.5 w-3.5" />
          </IconButton>
        )}

        <Divider />
        <IconButton label="Save" onClick={() => setPicker('save')} disabled={!tab.sql.trim()}>
          <IconSave className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="Saved" onClick={() => setPicker('saved')}>
          <IconBookmark className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="History" onClick={() => setPicker('history')}>
          <IconClock className="h-3.5 w-3.5" />
        </IconButton>

        <Divider />
        {/* Kept as two named buttons rather than one "Export ▾" menu: the mode
            bar already has an Export destination, and a second control named
            exactly "Export" would make export-page.spec's
            getByRole('button', { name: 'Export' }) ambiguous. */}
        <IconButton
          label="Export CSV"
          onClick={() => void exportData('csv')}
          disabled={!tab.source}
        >
          <IconDownload className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          label="Export JSON"
          onClick={() => void exportData('json')}
          disabled={!tab.source}
        >
          <IconBraces className="h-3.5 w-3.5" />
        </IconButton>

        {/* Pane collapse lives here, not in a caption row per pane. In the
            toolbar rather than on the resize handle because the handle is not
            rendered while a pane is collapsed — the control has to outlive it. */}
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            label={showEditorPane ? 'Hide editor pane' : 'Show editor pane'}
            onClick={() => setShowEditorPane((v) => !v)}
            disabled={!showResultsPane}
            pressed={showEditorPane}
          >
            <IconPanelTop className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label={showResultsPane ? 'Hide results pane' : 'Show results pane'}
            onClick={() => setShowResultsPane((v) => !v)}
            disabled={!showEditorPane}
            pressed={showResultsPane}
          >
            <IconPanelBottom className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="vertical">
          {/* No per-pane caption rows: a CodeMirror pane above a data grid does
              not need to be labelled "QUERY EDITOR" and "RESULTS", and both rows
              existed mainly to carry a collapse chevron that now lives in the
              toolbar. */}
          {showEditorPane && (
            <ResizablePanel defaultSize={50} minSize={20}>
              {/* key by tab so switching tabs remounts the editor with that tab's
                  text (the editor is uncontrolled — value is the initial doc). */}
              <SqlEditor
                key={tab.id}
                value={tab.sql}
                onChange={(v) => setSql(tab.id, v)}
                onRun={() => void run(tab.id)}
                connectionId={connId}
              />
            </ResizablePanel>
          )}
          {showEditorPane && showResultsPane && <ResizableHandle withHandle />}
          {showResultsPane && (
            <ResizablePanel minSize={20}>
              {tab.source ? (
                <ResultsGrid source={tab.source} />
              ) : (
                <div className="p-4 text-muted-foreground">Run a query to see results.</div>
              )}
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
      </div>
    </div>
  )
}

/** Icon-only toolbar button. `label` is both the tooltip and the accessible
 *  name, so a control that loses its visible text stays reachable by role+name
 *  (`getByRole('button', { name: 'Format' })`). */
function IconButton(props: {
  label: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`flex items-center rounded border border-transparent p-1.5 hover:border-border hover:bg-surface-2 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 ${
        props.pressed === false ? 'text-faint' : 'text-muted-foreground'
      }`}
    >
      {props.children}
    </button>
  )
}

/** Hairline separator grouping the toolbar into primary / authoring / library /
 *  export. Ten equal-weight buttons read as one undifferentiated row. */
function Divider(): React.JSX.Element {
  return <span className="mx-1 h-4 w-px flex-none bg-border" aria-hidden="true" />
}

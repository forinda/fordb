import { useEffect, useRef } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { basicSetup } from 'codemirror'
import { useConnStore } from '../store'
import { useQueryStore, type QueryTab } from '../store-query'
import { SqlEditor } from './SqlEditor'
import { ResultsGrid } from './ResultsGrid'
import { DocumentResults } from './DocumentResults'
import { TableDataGrid } from './TableDataGrid'
import { StructureView } from './StructureView'
import { ExplainView } from './ExplainView'
import { ObjectDefinitionView } from './ObjectDefinitionView'
import { QueryTabs } from './QueryTabs'
import IconPlay from '~icons/lucide/play'
import IconX from '~icons/lucide/x'
import IconAlignLeft from '~icons/lucide/align-left'
import IconSearch from '~icons/lucide/search'
import IconSave from '~icons/lucide/save'
import IconBookmark from '~icons/lucide/bookmark'
import IconClock from '~icons/lucide/clock'
import IconDownload from '~icons/lucide/download'
import { useDialect } from '../query/use-dialect'
import { Button } from './ui/button'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './ui/resizable'
import { stringifyCsv } from '@shared/csv/csv'
import { cmTheme, editorHighlight } from '../query/cm-theme'
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
        cmTheme,
        themeCompartment.current.of(editorHighlight(effective)),
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
      effects: themeCompartment.current.reconfigure(editorHighlight(effective))
    })
  }, [effective])

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

  return (
    <div className="flex flex-col h-full">
      <QueryTabs />
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <span className="text-sm text-muted-foreground">Collection</span>
        <span className="font-mono text-sm text-foreground">{doc.collection}</span>
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
        </div>
        <Button onClick={() => void run(tab.id)} disabled={tab.status === 'running'}>
          Run
        </Button>
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
            <div className="h-full min-h-0">
              {tab.docSource ? (
                <DocumentResults source={tab.docSource} tabId={tab.id} elapsedMs={tab.elapsedMs} />
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
  const { dialect, sqlLang } = useDialect()
  const docSupported = useDocumentQuerySupported(connId).data ?? false
  const tab = tabs.find((t) => t.id === activeId)

  useEffect(() => {
    if (tabs.length === 0) newTab()
  }, [tabs.length, newTab])

  if (!tab) return <div className="p-4 text-muted-foreground">No query tab.</div>

  async function exportData(kind: 'csv' | 'json'): Promise<void> {
    const src = tab!.source
    if (!src) return
    await src.drainAll()
    const names = src.fields.map((f) => f.name)
    const rows = Array.from({ length: src.loadedRowCount() }, (_, i) => src.getRow(i) ?? [])
    if (kind === 'csv')
      download('result.csv', stringifyCsv([names, ...rows.map((r) => r.map(cellStr))]), 'text/csv')
    else
      download(
        'result.json',
        JSON.stringify(
          rows.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i]]))),
          null,
          2
        ),
        'application/json'
      )
  }

  if (tab.kind === 'data') {
    return (
      <div className="flex flex-col h-full">
        <QueryTabs />
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
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-1 p-2">
        <button
          className="flex items-center gap-1.5 rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          onClick={() => void run(tab.id)}
          disabled={tab.status === 'running'}
        >
          <IconPlay className="h-3 w-3" />
          {/* Own span so getByText('Run', {exact:true}) still resolves (e2e). */}
          <span>Run</span>
          <span className="text-[10px] opacity-70">
            {window.fordb.platform === 'darwin' ? '⌘⏎' : 'Ctrl ⏎'}
          </span>
        </button>
        <button
          className="flex items-center gap-1 rounded border border-transparent px-2 py-1 text-xs text-muted-foreground hover:border-border hover:bg-surface-2 hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          onClick={() => void cancel(tab.id)}
          disabled={tab.status !== 'running'}
        >
          <IconX className="h-3 w-3" />
          Cancel
        </button>
        <GhostButton
          icon={<IconAlignLeft className="h-3 w-3" />}
          onClick={() => formatActive(sqlLang)}
          disabled={!tab.sql.trim()}
        >
          Format
        </GhostButton>
        <GhostButton
          icon={<IconSearch className="h-3 w-3" />}
          onClick={() => void openExplain(dialect, false)}
          disabled={!tab.sql.trim()}
        >
          Explain
        </GhostButton>
        {dialect === 'pg' && (
          <GhostButton
            icon={<IconSearch className="h-3 w-3" />}
            onClick={() => void openExplain(dialect, true)}
            disabled={!tab.sql.trim()}
          >
            Explain analyze
          </GhostButton>
        )}
        <GhostButton
          icon={<IconSave className="h-3 w-3" />}
          onClick={() => setPicker('save')}
          disabled={!tab.sql.trim()}
        >
          Save
        </GhostButton>
        <GhostButton icon={<IconBookmark className="h-3 w-3" />} onClick={() => setPicker('saved')}>
          Saved
        </GhostButton>
        <GhostButton icon={<IconClock className="h-3 w-3" />} onClick={() => setPicker('history')}>
          History
        </GhostButton>
        <GhostButton
          icon={<IconDownload className="h-3 w-3" />}
          onClick={() => void exportData('csv')}
          disabled={!tab.source}
        >
          Export CSV
        </GhostButton>
        <GhostButton
          icon={<IconDownload className="h-3 w-3" />}
          onClick={() => void exportData('json')}
          disabled={!tab.source}
        >
          Export JSON
        </GhostButton>
        <span className="text-sm text-muted-foreground ml-auto">
          {tab.status === 'running' && 'running…'}
          {tab.status === 'done' &&
            tab.source &&
            `${tab.source.loadedRowCount()} rows${tab.source.done() ? '' : '+'} · ${Math.round(tab.elapsedMs ?? 0)}ms`}
          {tab.status === 'done' && !tab.source && tab.message}
          {tab.status === 'error' && <span className="text-destructive">{tab.message}</span>}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="vertical">
          <ResizablePanel defaultSize={50} minSize={20}>
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex flex-none items-center border-b border-border-soft bg-surface-1 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Query editor
              </div>
              <div className="min-h-0 flex-1">
                {/* key by tab so switching tabs remounts the editor with that tab's
                  text (the editor is uncontrolled — value is the initial doc). */}
                <SqlEditor
                  key={tab.id}
                  value={tab.sql}
                  onChange={(v) => setSql(tab.id, v)}
                  onRun={() => void run(tab.id)}
                  connectionId={connId}
                />
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel minSize={20}>
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex flex-none items-center border-b border-border-soft bg-surface-1 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Results
              </div>
              <div className="min-h-0 flex-1">
                {tab.source ? (
                  <ResultsGrid source={tab.source} />
                ) : (
                  <div className="p-4 text-muted-foreground">Run a query to see results.</div>
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}

/** Dialect ghost toolbar button: 12px, icon + label, hairline hover. */
function GhostButton(props: {
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      className="flex items-center gap-1 rounded border border-transparent px-2 py-1 text-xs text-muted-foreground hover:border-border hover:bg-surface-2 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.icon}
      {props.children}
    </button>
  )
}

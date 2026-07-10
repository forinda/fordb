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
import { useDialect } from '../query/use-dialect'
import { Button } from './ui/button'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './ui/resizable'
import { stringifyCsv } from '@shared/csv/csv'
import { cmTheme, editorHighlight } from '../query/cm-theme'
import { useThemeStore } from '../store-theme'

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

  return (
    <div className="flex flex-col h-full">
      <QueryTabs />
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <Button onClick={() => void run(tab.id)} disabled={tab.status === 'running'}>
          Run
        </Button>
        <Button
          variant="outline"
          onClick={() => void cancel(tab.id)}
          disabled={tab.status !== 'running'}
        >
          Cancel
        </Button>
        <Button variant="ghost" onClick={() => formatActive(sqlLang)} disabled={!tab.sql.trim()}>
          Format
        </Button>
        <Button
          variant="ghost"
          onClick={() => void openExplain(dialect, false)}
          disabled={!tab.sql.trim()}
        >
          Explain
        </Button>
        {dialect === 'pg' && (
          <Button
            variant="ghost"
            onClick={() => void openExplain(dialect, true)}
            disabled={!tab.sql.trim()}
          >
            Explain analyze
          </Button>
        )}
        <Button variant="ghost" onClick={() => setPicker('save')} disabled={!tab.sql.trim()}>
          Save
        </Button>
        <Button variant="ghost" onClick={() => setPicker('saved')}>
          Saved
        </Button>
        <Button variant="ghost" onClick={() => setPicker('history')}>
          History
        </Button>
        <Button variant="ghost" onClick={() => void exportData('csv')} disabled={!tab.source}>
          Export CSV
        </Button>
        <Button variant="ghost" onClick={() => void exportData('json')} disabled={!tab.source}>
          Export JSON
        </Button>
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
            <div className="h-full min-h-0">
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
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel minSize={20}>
            <div className="h-full min-h-0">
              {tab.source ? (
                <ResultsGrid source={tab.source} />
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

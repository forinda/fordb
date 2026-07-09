import { useEffect } from 'react'
import { useConnStore } from '../store'
import { useQueryStore } from '../store-query'
import { SqlEditor } from './SqlEditor'
import { ResultsGrid } from './ResultsGrid'
import { TableDataGrid } from './TableDataGrid'
import { QueryTabs } from './QueryTabs'
import { Button } from './ui/button'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './ui/resizable'

function toCsv(fields: string[], rows: unknown[][]): string {
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [fields.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
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
    if (kind === 'csv') download('result.csv', toCsv(names, rows), 'text/csv')
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

import { useState } from 'react'
import JsonView from '@uiw/react-json-view'
import type { DocumentResultSource } from '../query/documents'
import { Button } from './ui/button'

type ViewMode = 'tree' | 'raw'

function DocumentCard(props: { doc: Record<string, unknown> }): React.JSX.Element {
  const [mode, setMode] = useState<ViewMode>('tree')
  return (
    <div className="rounded border border-border p-2">
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
      </div>
      {mode === 'tree' ? (
        <JsonView value={props.doc} />
      ) : (
        <pre className="overflow-auto text-xs">{JSON.stringify(props.doc, null, 2)}</pre>
      )}
    </div>
  )
}

/** Scrollable list of a document-mode run's results. Each document is a card
 *  with a per-card Tree/Raw toggle. `source.docs`/`source.done` are read LIVE
 *  each render (mutated in place by loadMore()) — `tick` mirrors the
 *  ResultsGrid live-count pattern, forcing a re-render once a background page
 *  resolves. */
export function DocumentResults(props: {
  source: DocumentResultSource
  elapsedMs?: number
}): React.JSX.Element {
  const { source } = props
  const [, setTick] = useState(0)
  const [loading, setLoading] = useState(false)

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

  if (source.docs.length === 0)
    return <div className="p-4 text-muted-foreground">No documents.</div>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 min-h-0 overflow-auto p-2">
        <div className="flex flex-col gap-2">
          {source.docs.map((doc, i) => (
            <DocumentCard key={i} doc={doc} />
          ))}
        </div>
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

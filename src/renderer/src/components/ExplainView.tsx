import type { QueryTab } from '../store-query'

/** Formatted plan view for an 'explain' tab — the generated EXPLAIN statement
 *  above the plan rows in a monospace block. */
export function ExplainView(props: { tab: QueryTab }): React.JSX.Element {
  const { tab } = props
  return (
    <div className="flex h-full flex-col overflow-auto p-3 text-sm">
      <div className="mb-2 font-mono text-xs text-muted-foreground">{tab.sql}</div>
      {tab.status === 'error' ? (
        <div className="rounded bg-destructive/10 p-2 text-destructive">{tab.message}</div>
      ) : (
        <pre className="overflow-x-auto rounded bg-muted/40 p-2 font-mono text-xs">
          {(tab.explainRows ?? []).join('\n') || (tab.status === 'running' ? 'running…' : '')}
        </pre>
      )}
    </div>
  )
}

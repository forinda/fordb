import { useQueryStore } from '../store-query'
import { Button } from './ui/button'

export function QueryTabs(): React.JSX.Element {
  const tabs = useQueryStore((s) => s.tabs)
  const active = useQueryStore((s) => s.activeTabId)
  const setActive = useQueryStore((s) => s.setActive)
  const closeTab = useQueryStore((s) => s.closeTab)
  const newTab = useQueryStore((s) => s.newTab)
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-surface-1 px-2 pt-1">
      {tabs.map((t, i) => (
        <div
          key={t.id}
          className={`flex shrink-0 items-center gap-1 rounded-t border border-b-0 px-2 py-1 text-sm ${
            t.id === active
              ? 'border-border bg-background text-foreground'
              : 'border-transparent text-muted-foreground hover:bg-surface-2/60'
          }`}
        >
          <button onClick={() => setActive(t.id)}>Query {i + 1}</button>
          <button
            className="rounded px-0.5 text-xs text-faint hover:text-destructive"
            onClick={() => closeTab(t.id)}
            aria-label="Close tab"
          >
            ×
          </button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0"
        onClick={newTab}
        aria-label="New query tab"
      >
        +
      </Button>
    </div>
  )
}

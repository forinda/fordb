import { useQueryStore } from '../store-query'
import { Button } from './ui/button'

export function QueryTabs(): React.JSX.Element {
  const tabs = useQueryStore((s) => s.tabs)
  const active = useQueryStore((s) => s.activeTabId)
  const setActive = useQueryStore((s) => s.setActive)
  const closeTab = useQueryStore((s) => s.closeTab)
  const newTab = useQueryStore((s) => s.newTab)
  return (
    <div className="flex items-center gap-1 border-b border-border px-2">
      {tabs.map((t, i) => (
        <div
          key={t.id}
          className={`flex items-center gap-1 px-2 py-1 text-sm rounded-t ${t.id === active ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
        >
          <button onClick={() => setActive(t.id)}>Query {i + 1}</button>
          <button className="text-xs" onClick={() => closeTab(t.id)} aria-label="Close tab">
            ×
          </button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={newTab} aria-label="New query tab">
        +
      </Button>
    </div>
  )
}

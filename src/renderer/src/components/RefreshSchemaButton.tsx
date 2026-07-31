import IconRefresh from '~icons/lucide/refresh-cw'
import { useConnStore } from '../store'
import { queryClient } from '../query/client'
import { invalidateIntrospection } from '../query/introspection'

/** Icon-only refresh, sitting beside the tree filter. It previously owned a
 *  full-width bordered row of its own in the sidebar for this one button. The
 *  accessible name is unchanged, so it stays reachable by role+name. */
export function RefreshSchemaButton(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  return (
    <button
      aria-label="Refresh schema"
      title="Refresh schema"
      disabled={!connId}
      onClick={() => {
        if (connId) void invalidateIntrospection(queryClient, connId)
      }}
      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      <IconRefresh className="h-3.5 w-3.5" />
    </button>
  )
}

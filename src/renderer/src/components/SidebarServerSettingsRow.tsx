import IconServerCog from '~icons/lucide/server-cog'
import { useConnStore } from '../store'
import { useQueryStore } from '../store-query'
import { useServerAdminSupported } from '../query/admin'

/** Sidebar "Server settings" row — opens the Postgres GUC settings as a
 *  first-class full-pane view. Previously the server settings panel had no
 *  discoverable entry point (a sub-tab under the monitoring dashboard). Hidden
 *  for engines without server admin (SQLite, Mongo). */
export function SidebarServerSettingsRow(): React.JSX.Element | null {
  const connId = useConnStore((s) => s.activeConnectionId)
  const setMainView = useQueryStore((s) => s.setMainView)
  const adminSupported = useServerAdminSupported(connId).data ?? false

  if (!adminSupported) return null

  return (
    <button
      aria-label="server-settings"
      className="flex w-full items-center gap-2 border-b border-border px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
      onClick={() => setMainView('serverSettings')}
    >
      <IconServerCog className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">Server settings</span>
    </button>
  )
}

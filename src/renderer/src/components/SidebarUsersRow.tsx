import IconUsers from '~icons/lucide/users'
import { useConnStore } from '../store'
import { useUiStore } from '../store-ui'
import { useQueryStore } from '../store-query'
import { useServerAdminSupported } from '../query/admin'
import { useDocumentQuerySupported } from '../query/documents'

/** Sidebar "Users & roles" row — a visible, engine-routed entry point for user
 *  management (previously buried in the "⋯" menu / a schema-node right-click).
 *  Postgres → the roles dashboard; Mongo → the per-database users modal (owned
 *  by SchemaTree, opened via a one-shot ui-store flag). Hidden for engines with
 *  no users surface (SQLite). */
export function SidebarUsersRow(): React.JSX.Element | null {
  const connId = useConnStore((s) => s.activeConnectionId)
  const setMainView = useQueryStore((s) => s.setMainView)
  const requestDashboardTab = useUiStore((s) => s.requestDashboardTab)
  const requestUsers = useUiStore((s) => s.requestUsers)
  const adminSupported = useServerAdminSupported(connId).data ?? false
  const docSupported = useDocumentQuerySupported(connId).data ?? false

  if (!adminSupported && !docSupported) return null

  function open(): void {
    if (adminSupported) {
      setMainView('dashboard')
      requestDashboardTab('roles')
    } else {
      requestUsers()
    }
  }

  return (
    <button
      aria-label="users-and-roles"
      className="flex w-full items-center gap-2 border-b border-border px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
      onClick={open}
    >
      <IconUsers className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">Users &amp; roles</span>
    </button>
  )
}

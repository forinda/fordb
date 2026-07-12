import { useState } from 'react'
import IconPlugConnected from '~icons/lucide/plug-zap'
import { connectionLabel } from '@shared/connection-label'
import { useProfiles } from '../query/profiles'
import { useConnStore } from '../store'
import { useUiStore } from '../store-ui'
import { useQueryStore } from '../store-query'
import { useServerStatsSupported } from '../query/stats'
import { useMongoStatsSupported } from '../query/mongo-stats'
import { useServerAdminSupported } from '../query/admin'

/** Server-level header shown in the sidebar while connected: the active
 *  connection's name + engine, a "⋯" menu for server-scoped actions (dashboard,
 *  roles), and disconnect. Switching connections lives on the title bar's
 *  Connections screen toggle (Dialect two-screen shell). */
export function ActiveConnectionBar(props: { onDisconnect: () => void }): React.JSX.Element {
  const activeProfileId = useConnStore((s) => s.activeProfileId)
  const connId = useConnStore((s) => s.activeConnectionId)
  const { data: profiles = [] } = useProfiles()
  const profile = profiles.find((p) => p.id === activeProfileId)

  const setMainView = useQueryStore((s) => s.setMainView)
  const requestDashboardTab = useUiStore((s) => s.requestDashboardTab)
  const statsSupported = useServerStatsSupported(connId).data ?? false
  const mongoStatsSupported = useMongoStatsSupported(connId).data ?? false
  const adminSupported = useServerAdminSupported(connId).data ?? false
  const dashboardSupported = statsSupported || mongoStatsSupported

  const [menuOpen, setMenuOpen] = useState(false)

  // Server-scoped actions. Roles are cluster-wide, so they live here (not on a
  // database or schema node) — the audit's fix for the split placement.
  const items: { label: string; run: () => void }[] = []
  if (dashboardSupported)
    items.push({ label: 'Server dashboard', run: () => setMainView('dashboard') })
  if (adminSupported)
    items.push({
      label: 'Roles & privileges…',
      run: () => {
        setMainView('dashboard')
        requestDashboardTab('roles')
      }
    })

  return (
    <div className="relative flex items-center gap-1 border-b border-border px-2 py-1.5">
      <IconPlugConnected className="h-4 w-4 shrink-0 text-primary" aria-label="connected" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground">
          {profile ? connectionLabel(profile) : 'Connected'}
        </div>
        {profile && (
          <div className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
            {profile.engine} · server
          </div>
        )}
      </div>
      {items.length > 0 && (
        <button
          aria-label="server-actions"
          title="Server actions"
          className="shrink-0 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted"
          onClick={() => setMenuOpen((v) => !v)}
        >
          ⋯
        </button>
      )}
      <button
        aria-label="disconnect"
        title="Disconnect"
        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"
        onClick={props.onDisconnect}
      >
        Disconnect
      </button>
      {menuOpen && items.length > 0 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-2 top-full z-50 mt-1 min-w-44 rounded border border-border bg-background py-1 text-sm shadow-md">
            {items.map((item) => (
              <button
                key={item.label}
                className="block w-full px-3 py-1 text-left text-foreground hover:bg-muted"
                onClick={() => {
                  item.run()
                  setMenuOpen(false)
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

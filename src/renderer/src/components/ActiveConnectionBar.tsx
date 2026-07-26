import { useState } from 'react'
import IconPlugConnected from '~icons/lucide/plug-zap'
import IconChevron from '~icons/lucide/chevrons-up-down'
import IconCheck from '~icons/lucide/check'
import { connectionLabel } from '@shared/connection-label'
import { useProfiles } from '../query/profiles'
import { useConnStore } from '../store'
import { useUiStore } from '../store-ui'
import { useQueryStore } from '../store-query'
import { useServerStatsSupported } from '../query/stats'
import { useMongoStatsSupported } from '../query/mongo-stats'
import { profileAddress } from './ConnectionManager'

/** Server-level header shown in the sidebar while connected: a connection
 *  switcher (the active connection's name + a menu to switch to another saved
 *  profile in place, or add a new one), a "⋯" menu for server-scoped actions
 *  (monitoring), and disconnect. Switching reuses the vetted connect path
 *  (secrets resolve in main via connection.open) so no password re-prompt. */
export function ActiveConnectionBar(props: {
  onDisconnect: () => void
  onConnect: (connectionId: string, profileId: string, database: string | null) => void
  onAddConnection: () => void
}): React.JSX.Element {
  const activeProfileId = useConnStore((s) => s.activeProfileId)
  const connId = useConnStore((s) => s.activeConnectionId)
  const { data: profiles = [] } = useProfiles()
  const profile = profiles.find((p) => p.id === activeProfileId)

  const setMainView = useQueryStore((s) => s.setMainView)
  const setOverlay = useUiStore((s) => s.setConnecting)
  const showToast = useUiStore((s) => s.showToast)
  const statsSupported = useServerStatsSupported(connId).data ?? false
  const mongoStatsSupported = useMongoStatsSupported(connId).data ?? false
  const dashboardSupported = statsSupported || mongoStatsSupported

  const [menuOpen, setMenuOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [switching, setSwitching] = useState(false)

  // Switch to another saved profile in place. Reuses ConnectionDetails' connect
  // path: open() resolves the keychain secret in main (no renderer secret), the
  // overlay shows progress, failures surface as a toast.
  async function switchTo(p: (typeof profiles)[number]): Promise<void> {
    setSwitcherOpen(false)
    if (p.id === activeProfileId || switching) return
    setSwitching(true)
    setOverlay({ label: connectionLabel(p), host: profileAddress(p) })
    try {
      const newId = await window.fordb.connection.open(p.id)
      props.onConnect(newId, p.id, p.engine === 'postgres' ? p.database : null)
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setSwitching(false)
      setOverlay(null)
    }
  }

  // Server-scoped actions. Roles moved to the sidebar "Users & roles" row
  // (SidebarUsersRow), so this menu is just the dashboard shortcut now.
  const items: { label: string; run: () => void }[] = []
  if (dashboardSupported) items.push({ label: 'Monitoring', run: () => setMainView('monitoring') })

  return (
    <div className="relative flex items-center gap-1 border-b border-border px-2 py-1.5">
      <IconPlugConnected className="h-4 w-4 shrink-0 text-primary" aria-label="connected" />
      <button
        aria-label="connection-switcher"
        title="Switch connection"
        className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-muted"
        onClick={() => setSwitcherOpen((v) => !v)}
        disabled={switching}
      >
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
        <IconChevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
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
      {switcherOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSwitcherOpen(false)} />
          <div className="absolute left-2 top-full z-50 mt-1 max-h-80 min-w-56 overflow-auto rounded border border-border bg-background py-1 text-sm shadow-md">
            {profiles.map((p) => (
              <button
                key={p.id}
                className="flex w-full items-center gap-2 px-3 py-1 text-left text-foreground hover:bg-muted"
                onClick={() => void switchTo(p)}
              >
                <span className="w-4 shrink-0">
                  {p.id === activeProfileId && <IconCheck className="h-3.5 w-3.5 text-primary" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{connectionLabel(p)}</span>
                <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                  {p.engine}
                </span>
              </button>
            ))}
            <div className="my-1 border-t border-border" />
            <button
              className="block w-full px-3 py-1 text-left text-foreground hover:bg-muted"
              onClick={() => {
                setSwitcherOpen(false)
                props.onAddConnection()
              }}
            >
              + New connection
            </button>
          </div>
        </>
      )}
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

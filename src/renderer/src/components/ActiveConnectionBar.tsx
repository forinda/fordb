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
import { Menu, MenuItem, MenuSeparator } from './ui/menu'

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

  const [switching, setSwitching] = useState(false)

  // Switch to another saved profile in place. Reuses ConnectionDetails' connect
  // path: open() resolves the keychain secret in main (no renderer secret), the
  // overlay shows progress, failures surface as a toast.
  async function switchTo(p: (typeof profiles)[number]): Promise<void> {
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

  // Server-scoped actions. Destinations (monitoring/roles/settings) live in the
  // main-pane mode bar now, so this menu is just the monitoring shortcut.
  const items: { label: string; run: () => void }[] = []
  if (dashboardSupported) items.push({ label: 'Monitoring', run: () => setMainView('monitoring') })

  return (
    <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
      <IconPlugConnected className="h-4 w-4 shrink-0 text-primary" aria-label="connected" />
      <div className="min-w-0 flex-1">
        <Menu
          ariaLabel="connection-switcher"
          title="Switch connection"
          disabled={switching}
          maxHeightRem={20}
          className="flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-muted disabled:opacity-50"
          trigger={
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">
                  {profile ? connectionLabel(profile) : 'Connected'}
                </span>
                {profile && (
                  <span className="block truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                    {profile.engine} · server
                  </span>
                )}
              </span>
              <IconChevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </>
          }
        >
          {(close) => (
            <>
              {profiles.map((p) => (
                <MenuItem
                  key={p.id}
                  onClick={() => {
                    close()
                    void switchTo(p)
                  }}
                >
                  <span className="w-4 shrink-0">
                    {p.id === activeProfileId && <IconCheck className="h-3.5 w-3.5 text-primary" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{connectionLabel(p)}</span>
                  <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                    {p.engine}
                  </span>
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem
                onClick={() => {
                  close()
                  props.onAddConnection()
                }}
              >
                + New connection
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
      {items.length > 0 && (
        <Menu
          ariaLabel="server-actions"
          title="Server actions"
          align="end"
          className="shrink-0 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted"
          trigger="⋯"
        >
          {(close) =>
            items.map((item) => (
              <MenuItem
                key={item.label}
                onClick={() => {
                  close()
                  item.run()
                }}
              >
                {item.label}
              </MenuItem>
            ))
          }
        </Menu>
      )}
      <button
        aria-label="disconnect"
        title="Disconnect"
        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"
        onClick={props.onDisconnect}
      >
        Disconnect
      </button>
    </div>
  )
}

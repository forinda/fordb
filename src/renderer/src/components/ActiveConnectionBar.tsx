import IconPlugConnected from '~icons/lucide/plug-zap'
import { connectionLabel } from '@shared/connection-label'
import { useProfiles } from '../query/profiles'
import { useConnStore } from '../store'

/** Compact header shown in the sidebar while connected: the active
 *  connection's name + engine and a disconnect action. Switching lives on
 *  the title bar's Connections screen toggle (Dialect two-screen shell). */
export function ActiveConnectionBar(props: { onDisconnect: () => void }): React.JSX.Element {
  const activeProfileId = useConnStore((s) => s.activeProfileId)
  const { data: profiles = [] } = useProfiles()
  const profile = profiles.find((p) => p.id === activeProfileId)

  return (
    <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
      <IconPlugConnected className="h-4 w-4 shrink-0 text-primary" aria-label="connected" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground">
          {profile ? connectionLabel(profile) : 'Connected'}
        </div>
        {profile && <div className="truncate text-xs text-muted-foreground">{profile.engine}</div>}
      </div>
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

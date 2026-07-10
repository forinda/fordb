import { connectionLabel } from '@shared/connection-label'
import { useProfiles } from '../query/profiles'
import { useConnStore } from '../store'
import { useQueryStore } from '../store-query'
import { ThemeToggle } from './ThemeToggle'

/** Dialect status bar: connection state + engine on the left, the active
 *  tab's result summary (message + elapsed) in the middle, theme toggle on
 *  the right. Everything degrades gracefully when disconnected/idle. */
export function StatusBar(): React.JSX.Element {
  const activeProfileId = useConnStore((s) => s.activeProfileId)
  const { data: profiles = [] } = useProfiles()
  const profile = profiles.find((p) => p.id === activeProfileId)
  const activeTab = useQueryStore((s) => s.tabs.find((t) => t.id === s.activeTabId))

  return (
    <div className="flex h-6 flex-none items-center gap-3 border-t border-border bg-surface-2 px-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5 truncate">
        <span
          className={`h-1.5 w-1.5 flex-none rounded-full ${profile ? 'bg-success' : 'bg-faint'}`}
        />
        {profile ? (
          <>
            <span className="truncate">{connectionLabel(profile)}</span>
            <span className="uppercase text-faint">{profile.engine}</span>
          </>
        ) : (
          'Not connected'
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-center">
        {activeTab?.message}
        {activeTab?.elapsedMs != null && (
          <span className="text-faint"> · {Math.round(activeTab.elapsedMs)} ms</span>
        )}
      </span>
      <ThemeToggle />
    </div>
  )
}

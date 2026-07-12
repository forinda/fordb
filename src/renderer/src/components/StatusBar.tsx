import { useState } from 'react'
import { connectionLabel } from '@shared/connection-label'
import { useProfiles } from '../query/profiles'
import { useConnStore } from '../store'
import { useQueryStore } from '../store-query'
import { ThemeToggle } from './ThemeToggle'
import { Preferences } from './Preferences'

/** Dialect status bar: connection state + engine on the left, the active
 *  tab's result summary (message + elapsed) in the middle, theme toggle on
 *  the right. Everything degrades gracefully when disconnected/idle. */
export function StatusBar(props: { aiOpen: boolean; onToggleAi: () => void }): React.JSX.Element {
  const activeProfileId = useConnStore((s) => s.activeProfileId)
  const { data: profiles = [] } = useProfiles()
  const profile = profiles.find((p) => p.id === activeProfileId)
  const activeTab = useQueryStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const [prefsOpen, setPrefsOpen] = useState(false)

  return (
    <div className="flex h-6 flex-none items-center gap-3 border-t border-border bg-surface-2 px-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5 truncate">
        <span
          className={`h-1.5 w-1.5 flex-none rounded-full ${profile ? 'bg-success' : 'bg-faint'}`}
        />
        {profile ? (
          <>
            <span className="truncate">{connectionLabel(profile)}</span>
            {/* Real info stays muted-foreground (AA); --faint is placeholder-only. */}
            <span className="uppercase">{profile.engine}</span>
          </>
        ) : (
          'Not connected'
        )}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-center ${
          activeTab?.status === 'error' ? 'text-destructive' : ''
        }`}
      >
        {activeTab?.message}
        {activeTab?.elapsedMs != null && activeTab.status !== 'error' && (
          <span> · {Math.round(activeTab.elapsedMs)} ms</span>
        )}
      </span>
      <button
        className={`flex-none rounded px-1 hover:text-foreground ${props.aiOpen ? 'text-foreground' : ''}`}
        onClick={props.onToggleAi}
        aria-pressed={props.aiOpen}
        title="AI assistant"
      >
        AI
      </button>
      <button
        className="flex-none rounded px-1 hover:text-foreground"
        onClick={() => setPrefsOpen(true)}
        title="Preferences"
      >
        Settings
      </button>
      <ThemeToggle />
      <Preferences open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </div>
  )
}

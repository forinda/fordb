import IconSettings from '~icons/lucide/settings'
import { useUiStore } from '../store-ui'

/** Sidebar "Settings" row pinned at the bottom of the editor sidebar — opens the
 *  app Preferences modal (which StatusBar renders). The Preferences link in the
 *  StatusBar is easy to miss, so this gives it a first-class, always-visible
 *  home, matching the incumbent pattern (settings pinned at the sidebar floor). */
export function SidebarSettingsRow(): React.JSX.Element {
  const setPrefsOpen = useUiStore((s) => s.setPrefsOpen)
  return (
    <button
      aria-label="open-settings"
      className="flex w-full items-center gap-2 border-t border-border px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={() => setPrefsOpen(true)}
    >
      <IconSettings className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">Settings</span>
    </button>
  )
}

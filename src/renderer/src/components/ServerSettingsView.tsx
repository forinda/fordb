import { useConnStore } from '../store'
import { SettingsPanel } from './dashboard/SettingsPanel'

/** Server settings (Postgres GUCs) as a first-class full-pane view
 *  (Adminer-flat) — no longer nested as a sub-tab under the monitoring
 *  dashboard, which previously left it with no discoverable entry point. */
export function ServerSettingsView(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  if (!connId)
    return (
      <div className="p-4 text-muted-foreground">Connection lost — reconnect from the sidebar.</div>
    )
  return (
    <div className="h-full min-h-0 overflow-auto">
      <SettingsPanel connId={connId} />
    </div>
  )
}

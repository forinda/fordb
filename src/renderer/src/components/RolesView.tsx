import { useConnStore } from '../store'
import { RolesPanel } from './dashboard/RolesPanel'

/** Roles & privileges as a first-class full-pane view (Adminer-flat) — no longer
 *  nested as a sub-tab under the monitoring dashboard. */
export function RolesView(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  if (!connId)
    return (
      <div className="p-4 text-muted-foreground">Connection lost — reconnect from the sidebar.</div>
    )
  return (
    <div className="h-full min-h-0 overflow-auto">
      <RolesPanel connId={connId} />
    </div>
  )
}

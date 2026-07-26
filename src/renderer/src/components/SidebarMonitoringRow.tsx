import IconActivity from '~icons/lucide/activity'
import { useConnStore } from '../store'
import { useQueryStore } from '../store-query'
import { useServerStatsSupported } from '../query/stats'
import { useMongoStatsSupported } from '../query/mongo-stats'

/** Sidebar "Monitoring" row — opens the live server-metrics view (gauges,
 *  charts, sessions/locks) as a flat destination. Hidden for engines without
 *  server stats (SQLite). */
export function SidebarMonitoringRow(): React.JSX.Element | null {
  const connId = useConnStore((s) => s.activeConnectionId)
  const setMainView = useQueryStore((s) => s.setMainView)
  const statsSupported = useServerStatsSupported(connId).data ?? false
  const mongoStatsSupported = useMongoStatsSupported(connId).data ?? false

  if (!statsSupported && !mongoStatsSupported) return null

  return (
    <button
      aria-label="monitoring"
      className="flex w-full items-center gap-2 border-b border-border px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
      onClick={() => setMainView('monitoring')}
    >
      <IconActivity className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">Monitoring</span>
    </button>
  )
}

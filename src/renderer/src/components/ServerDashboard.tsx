import { useMemo, useState } from 'react'
import { useConnStore } from '../store'
import { useServerSnapshot, useSessions, useLocks } from '../query/stats'
import { useRateHistory } from '../query/use-rate-history'
import { TimeSeriesChart } from './charts/TimeSeriesChart'
import { Gauges } from './dashboard/Gauges'
import { SessionsTable } from './dashboard/SessionsTable'
import { LocksPanel } from './dashboard/LocksPanel'
import { ControlsBar } from './dashboard/ControlsBar'

export function ServerDashboard(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  const [intervalMs, setIntervalMs] = useState(2000)
  const [paused, setPaused] = useState(false)
  const opts = { intervalMs, enabled: !paused }

  const snapshotQ = useServerSnapshot(connId, opts)
  const sessionsQ = useSessions(connId, opts)
  const locksQ = useLocks(connId, opts)
  const { rates, connections } = useRateHistory(connId, snapshotQ.data)

  const t = useMemo(() => rates.map((r) => r.tMs / 1000), [rates])
  const tpsData = useMemo(() => [t, rates.map((r) => r.tps)], [t, rates])
  const cacheData = useMemo(() => [t, rates.map((r) => r.cacheHitRatio * 100)], [t, rates])
  const tupleData = useMemo(() => [t, rates.map((r) => r.tuplesPerSec)], [t, rates])
  const connT = useMemo(() => connections.map((c) => c.tMs / 1000), [connections])
  const connData = useMemo(
    () => [
      connT,
      connections.map((c) => c.active),
      connections.map((c) => c.idle),
      connections.map((c) => c.idleInTransaction)
    ],
    [connT, connections]
  )

  // Errors surface per-panel (spec §7) — a failing snapshot must not blank the
  // ControlsBar or the independently-polled sessions/locks panels.
  const panelError = (q: { isError: boolean; error: unknown }): string | null =>
    q.isError ? `Failed: ${q.error instanceof Error ? q.error.message : 'error'}` : null

  // On a db-host restart the connection is cleared (polling stops via the
  // enabled gate); show a lost state rather than an empty, dead dashboard.
  if (!connId)
    return (
      <div className="p-4 text-muted-foreground">Connection lost — reconnect from the sidebar.</div>
    )

  return (
    <div className="flex h-full flex-col overflow-auto">
      <ControlsBar
        intervalMs={intervalMs}
        onIntervalChange={setIntervalMs}
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
        fullVisibility={snapshotQ.data?.fullVisibility ?? true}
      />
      {panelError(snapshotQ) && (
        <div className="p-2 text-sm text-destructive">Stats {panelError(snapshotQ)}</div>
      )}
      {snapshotQ.data && <Gauges snapshot={snapshotQ.data} />}
      <div className="grid grid-cols-1 gap-2 p-2 lg:grid-cols-2">
        <TimeSeriesChart title="Transactions/s" labels={['tps']} data={tpsData} />
        <TimeSeriesChart
          title="Cache hit %"
          labels={['cache %']}
          data={cacheData}
          format={(v) => `${v.toFixed(0)}%`}
        />
        <TimeSeriesChart title="Tuples/s" labels={['tuples/s']} data={tupleData} />
        <TimeSeriesChart
          title="Connections"
          labels={['active', 'idle', 'idle in txn']}
          data={connData}
        />
      </div>
      <div className="border-t border-border p-2 text-sm font-medium text-muted-foreground">
        Sessions
      </div>
      {panelError(sessionsQ) && (
        <div className="p-2 text-sm text-destructive">Sessions {panelError(sessionsQ)}</div>
      )}
      {sessionsQ.data && <SessionsTable rows={sessionsQ.data} />}
      <div className="border-t border-border p-2 text-sm font-medium text-muted-foreground">
        Locks
      </div>
      {panelError(locksQ) && (
        <div className="p-2 text-sm text-destructive">Locks {panelError(locksQ)}</div>
      )}
      {locksQ.data && <LocksPanel rows={locksQ.data} />}
    </div>
  )
}

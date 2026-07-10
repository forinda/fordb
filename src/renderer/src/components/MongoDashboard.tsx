import { useEffect, useMemo, useState } from 'react'
import { useConnStore } from '../store'
import { useMongoSnapshot } from '../query/mongo-stats'
import { computeOpcounterRate, pushOpcounterSample } from '@shared/stats/mongo-rates'
import type { OpcounterRatePoint, OpcounterSample } from '@shared/stats/mongo-rates'
import { TimeSeriesChart } from './charts/TimeSeriesChart'
import { ControlsBar } from './dashboard/ControlsBar'

const WINDOW_MS = 5 * 60_000

function Stat(props: { label: string; value: string; alert?: boolean }): React.JSX.Element {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <div className={`text-lg ${props.alert ? 'text-destructive' : 'text-foreground'}`}>
        {props.value}
      </div>
    </div>
  )
}

/** Server-status dashboard for MongoDB connections — separate from the PG
 *  `ServerDashboard` because the metrics don't fit that shape (opcounters
 *  instead of xact/tuple counters, no sessions/locks/roles/settings surface).
 *  Gated by `useMongoStatsSupported` at the call site (App.tsx), mutually
 *  exclusive with `ServerDashboard`.
 *
 *  Mongo has no `pg_monitor`-style visibility gate — `serverStatus()` is
 *  either available (capability true) or not (dashboard hidden entirely by
 *  the caller), so `ControlsBar`'s `fullVisibility` prop is always passed
 *  `true` here (it only ever hides its "limited visibility" notice). */
export function MongoDashboard(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  const [intervalMs, setIntervalMs] = useState(2000)
  const [paused, setPaused] = useState(false)
  const snapshotQ = useMongoSnapshot(connId, { intervalMs, enabled: !paused })

  // Opcounters are cumulative — keep a short ring of samples and derive
  // per-second deltas between consecutive ones, mirroring the PG
  // use-rate-history pattern (query/use-rate-history.ts) but with the Mongo
  // reset-clamping semantics of shared/stats/mongo-rates.ts.
  const [samples, setSamples] = useState<OpcounterSample[]>([])

  useEffect(() => {
    setSamples([])
  }, [connId])

  useEffect(() => {
    if (!snapshotQ.data) return
    const tMs = performance.now()
    setSamples((buf) =>
      pushOpcounterSample(buf, { tMs, opcounters: snapshotQ.data.opcounters }, WINDOW_MS)
    )
  }, [snapshotQ.data])

  const rates = useMemo(() => {
    const out: OpcounterRatePoint[] = []
    for (let i = 1; i < samples.length; i++) {
      const r = computeOpcounterRate(samples[i - 1]!, samples[i]!)
      if (r) out.push(r)
    }
    return out
  }, [samples])

  const t = useMemo(() => rates.map((r) => r.tMs / 1000), [rates])
  const writeData = useMemo(
    () => [t, rates.map((r) => r.insert), rates.map((r) => r.update), rates.map((r) => r.delete)],
    [t, rates]
  )
  const readData = useMemo(
    () => [t, rates.map((r) => r.query), rates.map((r) => r.command)],
    [t, rates]
  )

  if (!connId)
    return (
      <div className="p-4 text-muted-foreground">Connection lost — reconnect from the sidebar.</div>
    )

  const snapshot = snapshotQ.data
  const error = snapshotQ.isError
    ? `Failed: ${snapshotQ.error instanceof Error ? snapshotQ.error.message : 'error'}`
    : null

  return (
    <div className="flex h-full flex-col overflow-auto">
      <ControlsBar
        intervalMs={intervalMs}
        onIntervalChange={setIntervalMs}
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
        fullVisibility
      />
      {error && <div className="p-2 text-sm text-destructive">Stats {error}</div>}

      {snapshot && (
        <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Connections" value={String(snapshot.connections.current)} />
          <Stat label="Available" value={String(snapshot.connections.available)} />
          <Stat label="Active" value={String(snapshot.connections.active)} />
          <Stat label="Resident mem" value={`${snapshot.mem.residentMb} MB`} />
          <Stat label="Virtual mem" value={`${snapshot.mem.virtualMb} MB`} />
          <Stat label="Uptime" value={`${Math.floor(snapshot.uptimeSec / 60)}m`} />
        </div>
      )}

      {snapshot?.repl && (
        <div className="flex items-center gap-2 px-2 pb-2 text-sm">
          <span className="rounded bg-muted px-2 py-0.5 font-medium text-foreground">
            {snapshot.repl.setName}
          </span>
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              snapshot.repl.primary
                ? 'bg-primary/20 text-primary'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {snapshot.repl.primary ? 'Primary' : snapshot.repl.secondary ? 'Secondary' : 'Other'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 p-2 lg:grid-cols-2">
        <TimeSeriesChart
          title="Writes/s"
          labels={['insert', 'update', 'delete']}
          data={writeData}
        />
        <TimeSeriesChart title="Reads & commands/s" labels={['query', 'command']} data={readData} />
      </div>
    </div>
  )
}

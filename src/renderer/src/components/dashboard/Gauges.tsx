import type { ServerSnapshot } from '@shared/adapter/stats-types'

function bytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

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

export function Gauges(props: { snapshot: ServerSnapshot }): React.JSX.Element {
  const s = props.snapshot
  const a = s.activityByState
  return (
    <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Active" value={String(a.active)} />
      <Stat label="Idle" value={String(a.idle)} />
      <Stat
        label="Idle in txn"
        value={String(a.idleInTransaction + a.idleInTransactionAborted)}
        alert={a.idleInTransaction + a.idleInTransactionAborted > 0}
      />
      <Stat label="Backends" value={`${s.backends} / ${s.maxConnections}`} />
      <Stat label="DB size" value={bytes(s.dbSizeBytes)} />
      <Stat label="Other" value={String(a.other)} />
    </div>
  )
}

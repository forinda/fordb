import { useState } from 'react'
import type { SessionRow } from '@shared/adapter/stats-types'

type SortKey = 'pid' | 'user' | 'state' | 'duration'
const LONG_MS = 30_000

function durationMs(r: SessionRow): number {
  if (r.queryStartMs == null) return 0
  return performance.timeOrigin + performance.now() - r.queryStartMs
}

interface AdminActions {
  onCancel(pid: number): void
  onTerminate(pid: number): void
}

export function SessionsTable(props: {
  rows: SessionRow[]
  admin?: AdminActions
}): React.JSX.Element {
  const [sort, setSort] = useState<SortKey>('duration')
  const rows = [...props.rows].sort((a, b) => {
    if (sort === 'duration') return durationMs(b) - durationMs(a)
    const av = String(a[sort] ?? '')
    const bv = String(b[sort] ?? '')
    return av.localeCompare(bv)
  })
  const th = (key: SortKey, label: string): React.JSX.Element => (
    <th className="cursor-pointer px-2 py-1 text-left font-medium" onClick={() => setSort(key)}>
      {label}
      {sort === key ? ' ↓' : ''}
    </th>
  )
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background text-muted-foreground">
          <tr>
            {th('pid', 'PID')}
            {th('user', 'User')}
            {th('state', 'State')}
            {th('duration', 'Duration')}
            <th className="px-2 py-1 text-left font-medium">Query</th>
            {props.admin && <th className="px-2 py-1 text-right font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const idleTxn =
              r.state === 'idle in transaction' || r.state === 'idle in transaction (aborted)'
            const long = r.state === 'active' && durationMs(r) > LONG_MS
            return (
              <tr
                key={r.pid}
                className={`border-t border-border ${idleTxn || long ? 'text-destructive' : 'text-foreground'}`}
              >
                <td className="px-2 py-1">{r.pid}</td>
                <td className="px-2 py-1">{r.user ?? '—'}</td>
                <td className="px-2 py-1">{r.state ?? '—'}</td>
                <td className="px-2 py-1">
                  {r.queryStartMs == null ? '—' : `${Math.round(durationMs(r) / 1000)}s`}
                </td>
                <td className="max-w-md truncate px-2 py-1 font-mono text-xs">{r.query ?? '—'}</td>
                {props.admin && (
                  <td className="whitespace-nowrap px-2 py-1 text-right">
                    <button
                      className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => props.admin!.onCancel(r.pid)}
                    >
                      Cancel
                    </button>
                    <button
                      className="ml-1 rounded px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if (window.confirm(`Terminate backend ${r.pid}? This forcibly closes it.`))
                          props.admin!.onTerminate(r.pid)
                      }}
                    >
                      Terminate
                    </button>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && <div className="p-4 text-muted-foreground">No sessions.</div>}
    </div>
  )
}

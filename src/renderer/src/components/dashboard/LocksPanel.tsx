import type { LockRow } from '@shared/adapter/stats-types'

export function LocksPanel(props: { rows: LockRow[] }): React.JSX.Element {
  if (props.rows.length === 0)
    return <div className="p-4 text-sm text-muted-foreground">No blocked sessions.</div>
  return (
    <table className="w-full text-sm">
      <thead className="text-muted-foreground">
        <tr>
          <th className="px-2 py-1 text-left font-medium">Blocked PID</th>
          <th className="px-2 py-1 text-left font-medium">Blocked by</th>
          <th className="px-2 py-1 text-left font-medium">Blocked query</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r, i) => (
          <tr key={`${r.blockedPid}-${r.blockingPid}-${i}`} className="border-t border-border">
            <td className="px-2 py-1">{r.blockedPid}</td>
            <td className="px-2 py-1">{r.blockingPid}</td>
            <td className="max-w-md truncate px-2 py-1 font-mono text-xs">
              {r.blockedQuery ?? '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

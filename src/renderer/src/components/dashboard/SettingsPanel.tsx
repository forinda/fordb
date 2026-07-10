import { useMemo, useState } from 'react'
import { useServerSettings } from '../../query/admin'

export function SettingsPanel(props: { connId: string }): React.JSX.Element {
  const settingsQ = useServerSettings(props.connId)
  const [filter, setFilter] = useState('')

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const all = settingsQ.data ?? []
    if (!q) return all
    return all.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.category ?? '').toLowerCase().includes(q)
    )
  }, [settingsQ.data, filter])

  if (settingsQ.isError)
    return <div className="p-4 text-sm text-destructive">Failed to load settings.</div>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or category…"
          className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left font-medium">Name</th>
              <th className="px-2 py-1 text-left font-medium">Value</th>
              <th className="px-2 py-1 text-left font-medium">Unit</th>
              <th className="px-2 py-1 text-left font-medium">Category</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr
                key={s.name}
                className="border-t border-border"
                title={s.description ?? undefined}
              >
                <td className="px-2 py-1 font-mono text-xs">{s.name}</td>
                <td className="px-2 py-1">{s.value}</td>
                <td className="px-2 py-1 text-muted-foreground">{s.unit ?? '—'}</td>
                <td className="px-2 py-1 text-muted-foreground">{s.category ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="p-4 text-muted-foreground">No settings match.</div>}
      </div>
    </div>
  )
}

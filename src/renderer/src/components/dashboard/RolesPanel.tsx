import { useState } from 'react'
import type { RoleInfo } from '@shared/adapter/admin-types'
import { useRoles, useRoleGrants } from '../../query/admin'

function attrs(r: RoleInfo): string[] {
  const a: string[] = []
  if (r.canLogin) a.push('login')
  if (r.superuser) a.push('super')
  if (r.createRole) a.push('createrole')
  if (r.createDb) a.push('createdb')
  if (r.replication) a.push('replication')
  return a
}

export function RolesPanel(props: { connId: string }): React.JSX.Element {
  const rolesQ = useRoles(props.connId)
  const [selected, setSelected] = useState<string | null>(null)
  const grantsQ = useRoleGrants(props.connId, selected)

  if (rolesQ.isError)
    return <div className="p-4 text-sm text-destructive">Failed to load roles.</div>

  return (
    <div className="flex h-full min-h-0">
      <div className="w-64 shrink-0 overflow-auto border-r border-border">
        {(rolesQ.data ?? []).map((r) => (
          <button
            key={r.name}
            onClick={() => setSelected(r.name)}
            className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-muted ${
              selected === r.name ? 'bg-muted font-medium' : ''
            }`}
          >
            <div className="truncate">{r.name}</div>
            <div className="flex flex-wrap gap-1 pt-0.5">
              {attrs(r).map((a) => (
                <span
                  key={a}
                  className="rounded bg-secondary px-1 text-[10px] text-secondary-foreground"
                >
                  {a}
                </span>
              ))}
              {r.memberOf.map((m) => (
                <span
                  key={m}
                  className="rounded border border-border px-1 text-[10px] text-muted-foreground"
                >
                  ∈ {m}
                </span>
              ))}
            </div>
          </button>
        ))}
        {rolesQ.data?.length === 0 && <div className="p-3 text-muted-foreground">No roles.</div>}
      </div>
      <div className="min-w-0 flex-1 overflow-auto">
        {!selected && <div className="p-4 text-muted-foreground">Select a role to see grants.</div>}
        {selected && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left font-medium">Schema</th>
                <th className="px-2 py-1 text-left font-medium">Table</th>
                <th className="px-2 py-1 text-left font-medium">Privilege</th>
                <th className="px-2 py-1 text-left font-medium">Grantor</th>
              </tr>
            </thead>
            <tbody>
              {(grantsQ.data ?? []).map((g, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-2 py-1">{g.schema}</td>
                  <td className="px-2 py-1">{g.table}</td>
                  <td className="px-2 py-1">{g.privilege}</td>
                  <td className="px-2 py-1 text-muted-foreground">{g.grantor ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selected && grantsQ.data?.length === 0 && (
          <div className="p-4 text-muted-foreground">No table grants for {selected}.</div>
        )}
      </div>
    </div>
  )
}

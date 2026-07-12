import { useState } from 'react'
import type { RoleInfo } from '@shared/adapter/admin-types'
import { buildDropRole, maskRolePassword } from '@shared/ddl/role-ddl'
import { useRoles, useRoleGrants } from '../../query/admin'
import { useQueryStore } from '../../store-query'
import { queryClient } from '../../query/client'
import { RoleFormDialog } from '../RoleFormDialog'
import { Modal } from '../ui/modal'

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
  // form: undefined = closed, null = create, RoleInfo = edit.
  const [form, setForm] = useState<RoleInfo | null | undefined>(undefined)
  const [previewStmts, setPreviewStmts] = useState<string[] | null>(null)

  const roles = rolesQ.data ?? []
  const selectedRole = roles.find((r) => r.name === selected) ?? null

  async function applyRoleDdl(): Promise<void> {
    if (!previewStmts) return
    const stmts = previewStmts
    setPreviewStmts(null)
    await useQueryStore.getState().applyDdl(stmts)
    await queryClient.invalidateQueries({ queryKey: ['conn', props.connId, 'roles'] })
  }

  if (rolesQ.isError)
    return <div className="p-4 text-sm text-destructive">Failed to load roles.</div>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border p-2 text-sm">
        <button
          className="rounded border border-border px-2 py-0.5 hover:bg-muted"
          onClick={() => setForm(null)}
        >
          + New role
        </button>
        {selectedRole && (
          <>
            <button
              className="rounded border border-border px-2 py-0.5 hover:bg-muted"
              onClick={() => setForm(selectedRole)}
            >
              Edit {selectedRole.name}
            </button>
            <button
              className="rounded border border-border px-2 py-0.5 text-destructive hover:bg-muted"
              onClick={() => setPreviewStmts([buildDropRole(selectedRole.name)])}
            >
              Drop {selectedRole.name}
            </button>
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 overflow-auto border-r border-border">
          {roles.map((r) => (
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
          {roles.length === 0 && <div className="p-3 text-muted-foreground">No roles.</div>}
        </div>
        <div className="min-w-0 flex-1 overflow-auto">
          {!selectedRole && (
            <div className="p-4 text-muted-foreground">Select a role to see grants.</div>
          )}
          {selectedRole && (
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
          {selectedRole && grantsQ.data?.length === 0 && (
            <div className="p-4 text-muted-foreground">
              No table grants for {selectedRole.name}.
            </div>
          )}
        </div>
      </div>
      <RoleFormDialog
        open={form !== undefined}
        onClose={() => setForm(undefined)}
        role={form ?? null}
        existingRoles={roles.map((r) => r.name)}
        onSubmit={(stmts) => {
          setForm(undefined)
          setPreviewStmts(stmts)
        }}
      />
      <Modal
        open={previewStmts !== null}
        onClose={() => setPreviewStmts(null)}
        title="Review role changes"
        footer={
          <>
            <button
              className="rounded border border-border px-3 py-1 text-sm hover:bg-muted"
              onClick={() => setPreviewStmts(null)}
            >
              Cancel
            </button>
            <button
              className="rounded bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
              onClick={() => void applyRoleDdl()}
            >
              Apply
            </button>
          </>
        }
      >
        <pre className="max-h-[50vh] overflow-auto rounded border border-border bg-surface-2 p-3 font-mono text-xs">
          {(previewStmts ?? []).map((s) => `${maskRolePassword(s)};`).join('\n')}
        </pre>
      </Modal>
    </div>
  )
}

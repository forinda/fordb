import { useEffect, useState } from 'react'
import type { RoleInfo } from '@shared/adapter/admin-types'
import {
  buildCreateRole,
  buildAlterRole,
  membershipChanges,
  type RoleAttrs
} from '@shared/ddl/role-ddl'
import { Modal } from './ui/modal'

const ATTR_LABELS: { key: keyof RoleAttrs; label: string }[] = [
  { key: 'login', label: 'Can log in' },
  { key: 'superuser', label: 'Superuser' },
  { key: 'createDb', label: 'Create databases' },
  { key: 'createRole', label: 'Create roles' },
  { key: 'replication', label: 'Replication' }
]

/** Create/edit a Postgres role. Emits the DDL statements to the caller (which
 *  previews + applies them); the dialog never runs SQL itself. */
export function RoleFormDialog(props: {
  open: boolean
  onClose: () => void
  role: RoleInfo | null // null = create
  existingRoles: string[]
  onSubmit: (statements: string[]) => void
}): React.JSX.Element {
  const editing = props.role
  const [name, setName] = useState('')
  const [attrs, setAttrs] = useState<RoleAttrs>({
    login: false,
    superuser: false,
    createDb: false,
    createRole: false,
    replication: false
  })
  const [password, setPassword] = useState('')
  const [memberOf, setMemberOf] = useState<string[]>([])

  useEffect(() => {
    if (!props.open) return
    setName(editing?.name ?? '')
    setAttrs({
      login: editing?.canLogin ?? false,
      superuser: editing?.superuser ?? false,
      createDb: editing?.createDb ?? false,
      createRole: editing?.createRole ?? false,
      replication: editing?.replication ?? false
    })
    setPassword('')
    setMemberOf(editing?.memberOf ?? [])
  }, [props.open, editing])

  function submit(): void {
    const n = name.trim()
    if (!n) return
    const stmts: string[] = []
    const pw = password || undefined
    if (editing) {
      stmts.push(buildAlterRole(n, attrs, pw))
      stmts.push(...membershipChanges(n, editing.memberOf, memberOf))
    } else {
      stmts.push(buildCreateRole(n, attrs, pw))
      stmts.push(...membershipChanges(n, [], memberOf))
    }
    props.onSubmit(stmts)
  }

  const toggleMember = (r: string): void =>
    setMemberOf((m) => (m.includes(r) ? m.filter((x) => x !== r) : [...m, r]))

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={editing ? `Edit role ${editing.name}` : 'New role'}
      footer={
        <>
          <button
            className="rounded border border-border px-3 py-1 text-sm hover:bg-muted"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            className="rounded bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
            disabled={!name.trim()}
            onClick={submit}
          >
            {editing ? 'Review changes' : 'Review'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="w-24">Name</span>
          <input
            className="flex-1 rounded border border-border bg-background px-2 py-1 disabled:opacity-60"
            value={name}
            disabled={!!editing}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-24">Password</span>
          <input
            type="password"
            className="flex-1 rounded border border-border bg-background px-2 py-1"
            value={password}
            placeholder={editing ? 'leave blank to keep unchanged' : 'optional'}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-muted-foreground">Attributes</legend>
          {ATTR_LABELS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={attrs[key]}
                onChange={(e) => setAttrs({ ...attrs, [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-muted-foreground">Member of</legend>
          {props.existingRoles
            .filter((r) => r !== name)
            .map((r) => (
              <label key={r} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={memberOf.includes(r)}
                  onChange={() => toggleMember(r)}
                />
                {r}
              </label>
            ))}
        </fieldset>
      </div>
    </Modal>
  )
}

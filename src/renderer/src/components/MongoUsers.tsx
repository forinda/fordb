import { useCallback, useEffect, useState } from 'react'
import type { MongoUserInfo } from '@shared/adapter/document-types'
import { hostApi } from '../rpc'
import { Modal } from './ui/modal'

// Common built-in database roles (the ones a per-db admin usually grants).
const ROLES = ['read', 'readWrite', 'dbAdmin', 'dbOwner', 'userAdmin'] as const

/** Manage a MongoDB database's users: list, create (with a transient password),
 *  and drop. `db` is the Mongo database (the tree "schema"). */
export function MongoUsers(props: {
  connId: string
  db: string
  onClose: () => void
}): React.JSX.Element {
  const { connId, db } = props
  const [users, setUsers] = useState<MongoUserInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setUsers(await (await hostApi()).listMongoUsers(connId, db))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [connId, db])

  useEffect(() => {
    void load()
  }, [load])

  async function run(op: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await op()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  async function drop(user: string): Promise<void> {
    if (!window.confirm(`Drop user "${user}" on ${db}?`)) return
    await run(async () => (await hostApi()).dropMongoUser(connId, db, user))
  }

  return (
    <Modal open onClose={props.onClose} title={`Users — ${db}`}>
      <div className="flex flex-col gap-3 text-sm">
        {error && <div className="rounded bg-destructive/10 p-2 text-destructive">{error}</div>}
        <table className="w-full">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-medium">User</th>
              <th className="py-1 text-left font-medium">Roles</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user} className="border-t border-border">
                <td className="py-1 font-mono">{u.user}</td>
                <td className="py-1 text-muted-foreground">
                  {u.roles.map((r) => `${r.role}@${r.db}`).join(', ')}
                </td>
                <td className="py-1 text-right">
                  <button
                    className="rounded px-1 text-destructive hover:bg-muted disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void drop(u.user)}
                  >
                    drop
                  </button>
                </td>
              </tr>
            ))}
            {!busy && users.length === 0 && (
              <tr>
                <td colSpan={3} className="py-2 text-muted-foreground">
                  No users on {db}.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {creating ? (
          <CreateUserForm
            db={db}
            onCancel={() => setCreating(false)}
            onSubmit={(user, password, roles) => {
              setCreating(false)
              void run(async () =>
                (await hostApi()).createMongoUser(connId, db, user, password, roles)
              )
            }}
          />
        ) : (
          <button
            className="self-start rounded border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
            disabled={busy}
            onClick={() => setCreating(true)}
          >
            + Create user
          </button>
        )}
      </div>
    </Modal>
  )
}

function CreateUserForm(props: {
  db: string
  onCancel: () => void
  onSubmit: (user: string, password: string, roles: string[]) => void
}): React.JSX.Element {
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [roles, setRoles] = useState<Set<string>>(new Set(['readWrite']))
  const input = 'rounded border border-border bg-background px-2 py-1 text-sm'

  const toggle = (r: string): void =>
    setRoles((s) => {
      const n = new Set(s)
      if (n.has(r)) n.delete(r)
      else n.add(r)
      return n
    })

  const canSubmit = user.trim() && password && roles.size > 0

  return (
    <div className="flex flex-col gap-2 rounded border border-border p-2">
      <div className="flex gap-2">
        <input
          className={`${input} flex-1`}
          placeholder="username"
          value={user}
          onChange={(e) => setUser(e.target.value)}
        />
        <input
          className={`${input} flex-1`}
          type="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {ROLES.map((r) => (
          <label key={r} className="flex items-center gap-1">
            <input type="checkbox" checked={roles.has(r)} onChange={() => toggle(r)} />
            {r}
          </label>
        ))}
      </div>
      <div className="text-xs text-muted-foreground">Roles are granted on {props.db}.</div>
      <div className="flex gap-2">
        <button
          className="rounded bg-primary px-2 py-1 text-primary-foreground disabled:opacity-50"
          disabled={!canSubmit}
          onClick={() => props.onSubmit(user.trim(), password, [...roles])}
        >
          Create
        </button>
        <button className="rounded px-2 py-1 hover:bg-muted" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

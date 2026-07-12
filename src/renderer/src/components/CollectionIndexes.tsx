import { useState } from 'react'
import type { DocumentIndexSpec } from '@shared/adapter/document-types'
import { useIndexes } from '../query/introspection'
import { hostApi } from '../rpc'
import { queryClient } from '../query/client'
import { qk } from '../query/keys'
import { Modal } from './ui/modal'

/** Manage a MongoDB collection's indexes: list, drop, and create. `db` is the
 *  Mongo database (the tree's "schema"); `coll` the collection ("table"). */
export function CollectionIndexes(props: {
  connId: string
  db: string
  coll: string
  onClose: () => void
}): React.JSX.Element {
  const { connId, db, coll } = props
  const indexesQ = useIndexes(connId, db, coll)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: qk.indexes(connId, db, coll) })
  }

  async function run(op: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await op()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function drop(name: string): Promise<void> {
    if (!window.confirm(`Drop index "${name}" on ${db}.${coll}?`)) return
    await run(async () => (await hostApi()).dropDocIndex(connId, db, coll, name))
  }

  async function create(spec: DocumentIndexSpec): Promise<void> {
    setCreating(false)
    await run(async () => (await hostApi()).createDocIndex(connId, db, coll, spec))
  }

  const indexes = indexesQ.data ?? []

  return (
    <Modal open onClose={props.onClose} title={`Indexes — ${db}.${coll}`}>
      <div className="flex flex-col gap-3 text-sm">
        {error && <div className="rounded bg-destructive/10 p-2 text-destructive">{error}</div>}
        <table className="w-full">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-medium">Name</th>
              <th className="py-1 text-left font-medium">Fields</th>
              <th className="py-1 text-left font-medium">Unique</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {indexes.map((ix) => (
              <tr key={ix.name} className="border-t border-border">
                <td className="py-1 font-mono">{ix.name}</td>
                <td className="py-1 text-muted-foreground">{ix.columns.join(', ')}</td>
                <td className="py-1">{ix.unique ? 'yes' : ''}</td>
                <td className="py-1 text-right">
                  {/* The _id_ index is required and cannot be dropped. */}
                  {ix.name !== '_id_' && (
                    <button
                      className="rounded px-1 text-destructive hover:bg-muted disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void drop(ix.name)}
                    >
                      drop
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {creating ? (
          <CreateIndexForm onCancel={() => setCreating(false)} onSubmit={(s) => void create(s)} />
        ) : (
          <button
            className="self-start rounded border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
            disabled={busy}
            onClick={() => setCreating(true)}
          >
            + Create index
          </button>
        )}
      </div>
    </Modal>
  )
}

function CreateIndexForm(props: {
  onCancel: () => void
  onSubmit: (spec: DocumentIndexSpec) => void
}): React.JSX.Element {
  const [rows, setRows] = useState<{ field: string; dir: 1 | -1 }[]>([{ field: '', dir: 1 }])
  const [unique, setUnique] = useState(false)
  const [name, setName] = useState('')

  const input = 'rounded border border-border bg-background px-2 py-1 text-sm'
  const setRow = (i: number, patch: Partial<{ field: string; dir: 1 | -1 }>): void =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const keys = rows.filter((r) => r.field.trim())
  const canSubmit = keys.length > 0

  return (
    <div className="flex flex-col gap-2 rounded border border-border p-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={`${input} flex-1`}
            placeholder="field"
            value={r.field}
            onChange={(e) => setRow(i, { field: e.target.value })}
          />
          <select
            className={input}
            value={r.dir}
            onChange={(e) => setRow(i, { dir: Number(e.target.value) as 1 | -1 })}
          >
            <option value={1}>asc</option>
            <option value={-1}>desc</option>
          </select>
          <button
            className="rounded px-1 hover:bg-muted"
            onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        className="self-start text-xs underline"
        onClick={() => setRows((rs) => [...rs, { field: '', dir: 1 }])}
      >
        + field
      </button>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} />
          unique
        </label>
        <input
          className={`${input} flex-1`}
          placeholder="name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <button
          className="rounded bg-primary px-2 py-1 text-primary-foreground disabled:opacity-50"
          disabled={!canSubmit}
          onClick={() =>
            props.onSubmit({
              keys: Object.fromEntries(keys.map((r) => [r.field.trim(), r.dir])),
              unique: unique || undefined,
              name: name.trim() || undefined
            })
          }
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

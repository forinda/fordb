import { useMemo, useState, type ReactNode } from 'react'
import { Modal } from './ui/modal'
import type { DdlChange, CreateDatabaseOptions } from '@shared/adapter/schema-types'
import { useRoles } from '../query/introspection'

interface Props {
  open: boolean
  onClose: () => void
  connId: string
  onSubmit: (change: DdlChange) => void
}

export function CreateDatabaseDialog({ open, onClose, connId, onSubmit }: Props): ReactNode {
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('')
  const [encoding, setEncoding] = useState('UTF8')
  const [template, setTemplate] = useState('')
  const [lcCollate, setLcCollate] = useState('')
  const [lcCtype, setLcCtype] = useState('')
  const [tablespace, setTablespace] = useState('')
  const [connLimit, setConnLimit] = useState('')

  const { data: roles } = useRoles(open ? connId : null)

  const options = useMemo<CreateDatabaseOptions>(() => {
    const o: CreateDatabaseOptions = {}
    if (owner) o.owner = owner
    if (encoding) o.encoding = encoding
    if (template) o.template = template
    if (lcCollate) o.lcCollate = lcCollate
    if (lcCtype) o.lcCtype = lcCtype
    if (tablespace) o.tablespace = tablespace
    if (connLimit.trim() && Number.isFinite(Number(connLimit)))
      o.connectionLimit = Number(connLimit)
    return o
  }, [owner, encoding, template, lcCollate, lcCtype, tablespace, connLimit])

  const valid = name.trim().length > 0
  const field = 'w-full rounded border border-border bg-background px-2 py-1 text-sm'

  const submit = (): void => {
    if (!valid) return
    const hasOpts = Object.keys(options).length > 0
    onSubmit({ kind: 'createDatabase', name: name.trim(), options: hasOpts ? options : undefined })
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New database"
      footer={
        <>
          <button className="rounded px-2 py-0.5" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rounded bg-primary px-2 py-0.5 text-primary-foreground disabled:opacity-50"
            disabled={!valid}
            onClick={submit}
          >
            Create
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-xs">
          Name
          <input
            aria-label="db-name"
            autoFocus
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Owner
          <select
            aria-label="db-owner"
            className={field}
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="">(default)</option>
            {(roles ?? []).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Encoding
          <input
            aria-label="db-encoding"
            className={field}
            value={encoding}
            onChange={(e) => setEncoding(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Template
          <select
            aria-label="db-template"
            className={field}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          >
            <option value="">(default)</option>
            <option value="template1">template1</option>
            <option value="template0">template0</option>
          </select>
        </label>
        <label className="text-xs">
          Connection limit
          <input
            aria-label="db-connlimit"
            className={field}
            value={connLimit}
            onChange={(e) => setConnLimit(e.target.value)}
          />
        </label>
        <label className="text-xs">
          LC_COLLATE
          <input
            aria-label="db-collate"
            className={field}
            value={lcCollate}
            onChange={(e) => setLcCollate(e.target.value)}
          />
        </label>
        <label className="text-xs">
          LC_CTYPE
          <input
            aria-label="db-ctype"
            className={field}
            value={lcCtype}
            onChange={(e) => setLcCtype(e.target.value)}
          />
        </label>
        <label className="col-span-2 text-xs">
          Tablespace
          <input
            aria-label="db-tablespace"
            className={field}
            value={tablespace}
            onChange={(e) => setTablespace(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  )
}

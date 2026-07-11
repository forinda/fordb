import { useMemo, useState, type ReactNode } from 'react'
import { Modal } from './ui/modal'
import { buildDdl } from '@shared/ddl/build-ddl'
import type { DdlChange } from '@shared/adapter/schema-types'
import { PG_TYPES } from '@shared/ddl/pg-types'
import { SQLITE_TYPES } from '@shared/ddl/sqlite-types'
import { useSchemas, useTables, useColumns } from '../query/introspection'
import {
  buildTableSpec,
  duplicateColumnNames,
  emptyCol,
  type ColRow,
  type FkRow,
  type Dialect
} from '@shared/ddl/table-spec'

interface Props {
  open: boolean
  onClose: () => void
  connId: string
  schema: string
  dialect: Dialect
  onSubmit: (change: DdlChange) => void
}

export function CreateTableDialog({
  open,
  onClose,
  connId,
  schema,
  dialect,
  onSubmit
}: Props): ReactNode {
  const [table, setTable] = useState('')
  const [tab, setTab] = useState<'columns' | 'fks'>('columns')
  const [cols, setCols] = useState<ColRow[]>([emptyCol()])
  const [fks, setFks] = useState<FkRow[]>([])

  const typeOptions = dialect === 'pg' ? PG_TYPES : SQLITE_TYPES
  const { data: schemas } = useSchemas(connId)

  const spec = useMemo(
    () => buildTableSpec(cols, fks, table, schema, dialect),
    [cols, fks, table, schema, dialect]
  )

  const dups = useMemo(() => duplicateColumnNames(cols), [cols])
  const valid = spec.table.length > 0 && spec.columns.length > 0 && dups.length === 0
  const preview = valid ? buildDdl({ kind: 'createTable', spec }, dialect)[0] : ''

  const setCol = (i: number, patch: Partial<ColRow>): void =>
    setCols((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const move = (i: number, d: -1 | 1): void =>
    setCols((cs) => {
      const j = i + d
      if (j < 0 || j >= cs.length) return cs
      const next = cs.slice()
      const a = next[i]!
      next[i] = next[j]!
      next[j] = a
      return next
    })

  const submit = (): void => {
    if (!valid) return
    onSubmit({ kind: 'createTable', spec })
    onClose()
  }

  const colNames = cols.map((c) => c.name.trim()).filter(Boolean)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`New table in ${schema}`}
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
      <input
        aria-label="table-name"
        autoFocus
        placeholder="table name"
        className="mb-3 w-full rounded border border-border bg-background px-2 py-1"
        value={table}
        onChange={(e) => setTable(e.target.value)}
      />
      <div className="mb-2 flex gap-3 text-sm">
        <button
          className={tab === 'columns' ? 'font-medium underline' : ''}
          onClick={() => setTab('columns')}
        >
          Columns
        </button>
        <button
          className={tab === 'fks' ? 'font-medium underline' : ''}
          onClick={() => setTab('fks')}
        >
          Foreign Keys
        </button>
      </div>

      {tab === 'columns' && (
        <div className="space-y-1">
          {cols.map((c, i) => (
            <div key={i} className="flex items-center gap-1 text-xs">
              <input
                aria-label="col-name"
                placeholder="name"
                className="w-32 rounded border border-border bg-background px-1"
                value={c.name}
                onChange={(e) => setCol(i, { name: e.target.value })}
              />
              <input
                aria-label="col-type"
                list="fordb-col-types"
                placeholder="type"
                className="w-40 rounded border border-border bg-background px-1"
                value={c.type}
                onChange={(e) => setCol(i, { type: e.target.value })}
              />
              <label className="flex items-center gap-0.5">
                <input
                  type="checkbox"
                  checked={!c.nullable}
                  onChange={(e) => setCol(i, { nullable: !e.target.checked })}
                />
                NN
              </label>
              <label className="flex items-center gap-0.5">
                <input
                  type="checkbox"
                  checked={c.pk}
                  onChange={(e) => setCol(i, { pk: e.target.checked })}
                />
                PK
              </label>
              <label className="flex items-center gap-0.5">
                <input
                  type="checkbox"
                  checked={c.unique}
                  onChange={(e) => setCol(i, { unique: e.target.checked })}
                />
                UQ
              </label>
              <input
                aria-label="col-default"
                placeholder="default"
                className="w-24 rounded border border-border bg-background px-1"
                value={c.default}
                onChange={(e) => setCol(i, { default: e.target.value })}
              />
              <button title="move up" onClick={() => move(i, -1)}>
                ↑
              </button>
              <button title="move down" onClick={() => move(i, 1)}>
                ↓
              </button>
              <button title="remove" onClick={() => setCols((cs) => cs.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <datalist id="fordb-col-types">
            {typeOptions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <button
            className="text-xs underline"
            onClick={() => setCols((cs) => [...cs, emptyCol()])}
          >
            + column
          </button>
        </div>
      )}

      {tab === 'fks' && (
        <div className="space-y-2">
          {fks.map((f, i) => (
            <FkEditor
              key={i}
              connId={connId}
              schemas={schemas ?? []}
              localColumns={colNames}
              value={f}
              onChange={(patch) =>
                setFks((fs) => fs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
              }
              onRemove={() => setFks((fs) => fs.filter((_, j) => j !== i))}
            />
          ))}
          <button
            className="text-xs underline"
            onClick={() =>
              setFks((fs) => [
                ...fs,
                { name: '', columns: [], refSchema: schema, refTable: '', refColumns: [] }
              ])
            }
          >
            + foreign key
          </button>
        </div>
      )}

      {dups.length > 0 && (
        <p className="mt-3 text-xs text-red-500">Duplicate column name: {dups.join(', ')}</p>
      )}
      {preview && <pre className="mt-3 overflow-auto rounded bg-muted p-2 text-xs">{preview}</pre>}
    </Modal>
  )
}

function FkEditor(props: {
  connId: string
  schemas: string[]
  localColumns: string[]
  value: FkRow
  onChange: (patch: Partial<FkRow>) => void
  onRemove: () => void
}): ReactNode {
  const { connId, schemas, localColumns, value, onChange, onRemove } = props
  const { data: tables } = useTables(connId, value.refSchema || null)
  const { data: refCols } = useColumns(connId, value.refSchema || null, value.refTable || null)
  const sel = 'rounded border border-border bg-background px-1 text-xs'
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2 text-xs">
      <input
        aria-label="fk-name"
        placeholder="fk name (auto)"
        className={sel}
        value={value.name}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <select
        aria-label="fk-local-col"
        className={sel}
        value={value.columns[0] ?? ''}
        onChange={(e) => onChange({ columns: e.target.value ? [e.target.value] : [] })}
      >
        <option value="">local col…</option>
        {localColumns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <span>→</span>
      <select
        aria-label="fk-ref-schema"
        className={sel}
        value={value.refSchema}
        onChange={(e) => onChange({ refSchema: e.target.value, refTable: '', refColumns: [] })}
      >
        {schemas.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        aria-label="fk-ref-table"
        className={sel}
        value={value.refTable}
        onChange={(e) => onChange({ refTable: e.target.value, refColumns: [] })}
      >
        <option value="">table…</option>
        {(tables ?? []).map((t) => (
          <option key={t.name} value={t.name}>
            {t.name}
          </option>
        ))}
      </select>
      <select
        aria-label="fk-ref-col"
        className={sel}
        value={value.refColumns[0] ?? ''}
        onChange={(e) => onChange({ refColumns: e.target.value ? [e.target.value] : [] })}
      >
        <option value="">col…</option>
        {(refCols ?? []).map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
      <button title="remove" onClick={onRemove}>
        ✕
      </button>
    </div>
  )
}

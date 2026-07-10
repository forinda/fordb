import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnStore } from '../store'
import { useProfiles } from '../query/profiles'
import { useColumns, useKeys, useIndexes } from '../query/introspection'
import { hostApi } from '../rpc'
import { buildDdl, reconstructDdl } from '@shared/ddl/build-ddl'
import type { DdlChange } from '@shared/adapter/schema-types'
import { useQueryStore, type QueryTab } from '../store-query'

type Dialect = 'pg' | 'sqlite'

export function StructureView(props: { tab: QueryTab }): React.JSX.Element {
  const { schema, table } = props.tab.structure ?? { schema: '', table: '' }
  const connId = useConnStore((s) => s.activeConnectionId)
  const profileId = useConnStore((s) => s.activeProfileId)
  const applyDdl = useQueryStore((s) => s.applyDdl)

  const { data: profiles = [] } = useProfiles()
  const engine = profiles.find((p) => p.id === profileId)?.engine
  const dialect: Dialect = engine === 'postgres' ? 'pg' : 'sqlite'

  const { data: cols = [] } = useColumns(connId, schema, table)
  const { data: keys = [] } = useKeys(connId, schema, table)
  const { data: indexes = [] } = useIndexes(connId, schema, table)
  const { data: ops } = useQuery({
    queryKey: connId ? ['conn', connId, 'schemaOps'] : ['conn', 'none', 'schemaOps'],
    queryFn: async () => (await hostApi()).schemaOps(connId!),
    enabled: !!connId
  })

  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<null | 'column' | 'index' | 'fk'>(null)
  // Which column's inline Alter / Rename form is open (by name). Electron has no
  // window.prompt, so rename uses an inline input too.
  const [editCol, setEditCol] = useState<string | null>(null)
  const [renameColName, setRenameColName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Preview the generated SQL, confirm, apply. Any browse/tree cache refresh is
  // handled by the store's applyDdl (it invalidates introspection). The current
  // structure is always passed as context — harmless for PG/native ops, required
  // for the SQLite table-rebuild (alterColumn / FK add-drop).
  async function run(change: DdlChange): Promise<void> {
    // Serialize: a second op must not build its rebuild context from the current
    // (about-to-be-stale) structure while the first is still applying/refetching.
    if (busy) return
    setError(null)
    const statements = buildDdl(change, dialect, { columns: cols, keys, indexes })
    if (!window.confirm(`Apply this DDL?\n\n${statements.join(';\n')}`)) return
    setBusy(true)
    try {
      await applyDdl(statements)
      setForm(null)
      setEditCol(null)
      setRenameColName(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const fks = keys.filter((k) => k.kind === 'foreign')
  const ddlText = reconstructDdl(cols, keys, indexes, schema, table, dialect)

  return (
    <div className="flex h-full flex-col overflow-auto p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-semibold">
          {schema}.{table}
        </h2>
        {ops?.dropTable && (
          <button
            className="ml-auto rounded px-2 py-0.5 text-destructive hover:bg-muted"
            onClick={() => void run({ kind: 'dropTable', schema, table })}
          >
            Drop table
          </button>
        )}
      </div>
      {error && <div className="mb-2 rounded bg-destructive/10 p-1 text-destructive">{error}</div>}

      {/* Columns */}
      <Section
        title="Columns"
        action={
          ops?.addColumn ? { label: '+ column', onClick: () => setForm('column') } : undefined
        }
      >
        {cols.map((c) => (
          <div key={c.name}>
            <Row>
              <span className="font-mono">{c.name}</span>
              <span className="text-muted-foreground">{c.dataType}</span>
              <span className="text-muted-foreground">{c.nullable ? 'null' : 'not null'}</span>
              {c.defaultValue != null && (
                <span className="text-muted-foreground">default {c.defaultValue}</span>
              )}
              <span className="ml-auto flex gap-1">
                {ops?.renameColumn && (
                  <button
                    aria-label={`col-rename-${c.name}`}
                    className="rounded px-1 text-xs hover:bg-muted"
                    onClick={() => setRenameColName(renameColName === c.name ? null : c.name)}
                  >
                    rename
                  </button>
                )}
                {ops?.alterColumn && (
                  <button
                    aria-label={`col-alter-${c.name}`}
                    className="rounded px-1 text-xs hover:bg-muted"
                    onClick={() => setEditCol(editCol === c.name ? null : c.name)}
                  >
                    alter
                  </button>
                )}
                {ops?.dropColumn && (
                  <button
                    aria-label={`col-drop-${c.name}`}
                    className="rounded px-1 text-xs text-destructive hover:bg-muted"
                    onClick={() => void run({ kind: 'dropColumn', schema, table, column: c.name })}
                  >
                    drop
                  </button>
                )}
              </span>
            </Row>
            {renameColName === c.name && (
              <RenameColumnForm
                column={c.name}
                onCancel={() => setRenameColName(null)}
                onSubmit={(to) =>
                  void run({ kind: 'renameColumn', schema, table, from: c.name, to })
                }
              />
            )}
            {editCol === c.name && (
              <AlterColumnForm
                column={c.name}
                currentType={c.dataType}
                currentNotNull={!c.nullable}
                onCancel={() => setEditCol(null)}
                onSubmit={(change) => void run({ kind: 'alterColumn', schema, table, ...change })}
              />
            )}
          </div>
        ))}
        {form === 'column' && (
          <ColumnForm
            onCancel={() => setForm(null)}
            onSubmit={(column) => void run({ kind: 'addColumn', schema, table, column })}
          />
        )}
      </Section>

      {/* Indexes */}
      <Section
        title="Indexes"
        action={
          ops?.createIndex ? { label: '+ index', onClick: () => setForm('index') } : undefined
        }
      >
        {indexes.map((i) => (
          <Row key={i.name}>
            <span className="font-mono">{i.name}</span>
            <span className="text-muted-foreground">({i.columns.join(', ')})</span>
            {i.unique && <span className="text-muted-foreground">unique</span>}
            {ops?.dropIndex && (
              <button
                className="ml-auto rounded px-1 text-destructive hover:bg-muted"
                onClick={() => void run({ kind: 'dropIndex', schema, name: i.name })}
              >
                drop
              </button>
            )}
          </Row>
        ))}
        {form === 'index' && (
          <IndexForm
            columns={cols.map((c) => c.name)}
            onCancel={() => setForm(null)}
            onSubmit={(name, columns, unique) =>
              void run({ kind: 'createIndex', spec: { schema, table, name, columns, unique } })
            }
          />
        )}
      </Section>

      {/* Foreign keys */}
      <Section
        title="Foreign keys"
        action={ops?.addForeignKey ? { label: '+ FK', onClick: () => setForm('fk') } : undefined}
      >
        {fks.length === 0 && <Row>(none)</Row>}
        {fks.map((k) => (
          <Row key={k.name}>
            <span className="font-mono">{k.name}</span>
            <span className="text-muted-foreground">
              ({k.columns.join(', ')}) → {k.referencedTable}
            </span>
            {ops?.dropForeignKey && (
              <button
                className="ml-auto rounded px-1 text-destructive hover:bg-muted"
                onClick={() => void run({ kind: 'dropForeignKey', schema, table, name: k.name })}
              >
                drop
              </button>
            )}
          </Row>
        ))}
        {form === 'fk' && (
          <FkForm
            columns={cols.map((c) => c.name)}
            onCancel={() => setForm(null)}
            onSubmit={(spec) =>
              void run({ kind: 'addForeignKey', spec: { schema, table, ...spec } })
            }
          />
        )}
      </Section>

      <div className="mt-3">
        <div className="mb-1 text-muted-foreground">Reconstructed DDL</div>
        <pre className="overflow-x-auto rounded bg-muted/40 p-2 font-mono text-xs">{ddlText}</pre>
      </div>
    </div>
  )
}

function Section(props: {
  title: string
  action?: { label: string; onClick: () => void }
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-2 border-b border-border-soft pb-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {props.title}
        </span>
        {props.action && (
          <button
            className="ml-auto rounded px-2 py-0.5 text-xs hover:bg-muted"
            onClick={props.action.onClick}
          >
            {props.action.label}
          </button>
        )}
      </div>
      <div className="divide-y divide-border-soft rounded-lg border border-border bg-card px-2">
        {props.children}
      </div>
    </div>
  )
}

function Row(props: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex items-center gap-3 py-1 hover:bg-surface-1">{props.children}</div>
}

const input = 'rounded border border-border bg-background px-1 py-0.5'

function RenameColumnForm(props: {
  column: string
  onSubmit: (to: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [to, setTo] = useState(props.column)
  const submit = (): void => {
    const t = to.trim()
    if (t && t !== props.column) props.onSubmit(t)
  }
  return (
    <Row>
      <span className="text-muted-foreground">rename {props.column} →</span>
      <input
        aria-label="ddl-rename-to"
        className={input}
        value={to}
        onChange={(e) => setTo(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <button className="rounded bg-primary px-2 py-0.5 text-primary-foreground" onClick={submit}>
        Rename
      </button>
      <button className="rounded px-2 py-0.5 hover:bg-muted" onClick={props.onCancel}>
        Cancel
      </button>
    </Row>
  )
}

// Emits an alterColumn change carrying ONLY the fields the user actually changed
// (untouched fields stay undefined so PG emits minimal ALTERs and the SQLite
// rebuild is unambiguous).
function AlterColumnForm(props: {
  column: string
  currentType: string
  currentNotNull: boolean
  onSubmit: (change: {
    column: string
    type?: string
    default?: string | null
    notNull?: boolean
  }) => void
  onCancel: () => void
}): React.JSX.Element {
  const [type, setType] = useState(props.currentType)
  const [notNull, setNotNull] = useState(props.currentNotNull)
  const [def, setDef] = useState('')
  const [dropDef, setDropDef] = useState(false)
  return (
    <Row>
      <span className="text-muted-foreground">alter {props.column}:</span>
      <input
        aria-label="ddl-alter-type"
        className={input}
        placeholder="type"
        value={type}
        onChange={(e) => setType(e.target.value)}
      />
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={notNull} onChange={(e) => setNotNull(e.target.checked)} />
        not null
      </label>
      <input
        aria-label="ddl-alter-default"
        className={input}
        placeholder="default expr"
        value={def}
        disabled={dropDef}
        onChange={(e) => setDef(e.target.value)}
      />
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={dropDef} onChange={(e) => setDropDef(e.target.checked)} />
        drop default
      </label>
      <button
        className="rounded bg-primary px-2 py-0.5 text-primary-foreground"
        onClick={() =>
          props.onSubmit({
            column: props.column,
            ...(type !== props.currentType ? { type } : {}),
            ...(notNull !== props.currentNotNull ? { notNull } : {}),
            ...(dropDef ? { default: null } : def !== '' ? { default: def } : {})
          })
        }
      >
        Apply
      </button>
      <button className="rounded px-2 py-0.5 hover:bg-muted" onClick={props.onCancel}>
        Cancel
      </button>
    </Row>
  )
}

function ColumnForm(props: {
  onSubmit: (column: { name: string; type: string; notNull?: boolean }) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [notNull, setNotNull] = useState(false)
  return (
    <Row>
      <input
        aria-label="ddl-column-name"
        className={input}
        placeholder="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        aria-label="ddl-column-type"
        className={input}
        placeholder="type"
        value={type}
        onChange={(e) => setType(e.target.value)}
      />
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={notNull} onChange={(e) => setNotNull(e.target.checked)} />
        not null
      </label>
      <button
        className="rounded bg-primary px-2 py-0.5 text-primary-foreground disabled:opacity-50"
        disabled={!name || !type}
        onClick={() => props.onSubmit({ name, type, notNull })}
      >
        Add
      </button>
      <button className="rounded px-2 py-0.5 hover:bg-muted" onClick={props.onCancel}>
        Cancel
      </button>
    </Row>
  )
}

function IndexForm(props: {
  columns: string[]
  onSubmit: (name: string, columns: string[], unique: boolean) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [col, setCol] = useState(props.columns[0] ?? '')
  const [unique, setUnique] = useState(false)
  return (
    <Row>
      <input
        aria-label="ddl-index-name"
        className={input}
        placeholder="index name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <select
        aria-label="ddl-index-column"
        className={input}
        value={col}
        onChange={(e) => setCol(e.target.value)}
      >
        {props.columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} />
        unique
      </label>
      <button
        className="rounded bg-primary px-2 py-0.5 text-primary-foreground disabled:opacity-50"
        disabled={!name || !col}
        onClick={() => props.onSubmit(name, [col], unique)}
      >
        Add
      </button>
      <button className="rounded px-2 py-0.5 hover:bg-muted" onClick={props.onCancel}>
        Cancel
      </button>
    </Row>
  )
}

function FkForm(props: {
  columns: string[]
  onSubmit: (spec: {
    name: string
    columns: string[]
    refSchema: string
    refTable: string
    refColumns: string[]
  }) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [col, setCol] = useState(props.columns[0] ?? '')
  const [refSchema, setRefSchema] = useState('')
  const [refTable, setRefTable] = useState('')
  const [refColumn, setRefColumn] = useState('')
  return (
    <Row>
      <input
        aria-label="ddl-fk-name"
        className={input}
        placeholder="fk name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <select className={input} value={col} onChange={(e) => setCol(e.target.value)}>
        {props.columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <span>→</span>
      <input
        aria-label="ddl-fk-ref-schema"
        className={input}
        placeholder="ref schema"
        value={refSchema}
        onChange={(e) => setRefSchema(e.target.value)}
      />
      <input
        aria-label="ddl-fk-ref-table"
        className={input}
        placeholder="ref table"
        value={refTable}
        onChange={(e) => setRefTable(e.target.value)}
      />
      <input
        aria-label="ddl-fk-ref-column"
        className={input}
        placeholder="ref column"
        value={refColumn}
        onChange={(e) => setRefColumn(e.target.value)}
      />
      <button
        className="rounded bg-primary px-2 py-0.5 text-primary-foreground disabled:opacity-50"
        disabled={!name || !col || !refSchema || !refTable || !refColumn}
        onClick={() =>
          props.onSubmit({
            name,
            columns: [col],
            refSchema,
            refTable,
            refColumns: [refColumn]
          })
        }
      >
        Add
      </button>
      <button className="rounded px-2 py-0.5 hover:bg-muted" onClick={props.onCancel}>
        Cancel
      </button>
    </Row>
  )
}

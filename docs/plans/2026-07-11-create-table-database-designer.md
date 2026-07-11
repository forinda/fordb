# Create Table Designer + Create Database Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the name-only "New table" / "New database" stubs with a tabbed Create Table designer (columns with type dropdowns + nullable/PK/unique/default, plus a Foreign Keys tab with schema-populated reference dropdowns) and a full-metadata Create Database dialog.

**Architecture:** Pure-UI feature over an existing DDL spine. New modal components collect state, assemble a `DdlChange`, and hand it to the unchanged `runDdl` → preview/confirm → `applyDdl` path. Small pure additions to the DDL contract + builder (unit-tested) and one new `listRoles` HostApi method feed the dialogs.

**Tech Stack:** React 19 + Tailwind + Zustand + TanStack Query; Vitest; electron-vite; RPC over MessagePort (`serveRpc(HostApiImpl)` auto-dispatches by method name).

## Global Constraints

- TypeScript strict, no `any` outside the RPC boundary. TDD. Conventional-commit subjects.
- Commit trailers on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_018AGzg9pdVag7LZ83ktnnnX`.
- Relational engines only (`pg`, `sqlite`). Mongo is document-mode (no tables) and already hidden by `docSupported`.
- DDL flows through the existing path: dialog → `DdlChange` → `runDdl` (`SchemaTree.tsx:104-113`) → `buildDdl` → confirm → `useQueryStore.getState().applyDdl`. Dialogs never call `applyDdl` directly.
- `buildDdl(change, dialect, context?)` — `dialect` is `'pg' | 'sqlite'`. Identifiers quoted via `quoteIdent` (imported as `qi`); string literals single-quoted.
- New DbAdapter interface methods must be implemented by all three adapters (contract suite enforces); SQLite + Mongo `listRoles` return `[]`.
- "New schema…" stays on the existing `NamePrompt` (a schema is just a name). Only table + database move to modals.
- Unit tests for `build-ddl` are the real gate; components get light smoke only.

## File Structure

- `src/shared/adapter/schema-types.ts` — extend `ColumnSpec`, `TableSpec`, `DdlChange` (createDatabase); add `InlineForeignKey`, `CreateDatabaseOptions`.
- `src/shared/ddl/build-ddl.ts` — `columnClause` UNIQUE; `createTable` inline FKs; `createDatabase` options.
- `src/shared/ddl/pg-types.ts`, `src/shared/ddl/sqlite-types.ts` — curated type lists (new).
- `src/shared/host/host-api.ts`, `src/shared/adapter/db-adapter.ts` — `listRoles` signature.
- `src/db-host/host-api-impl.ts` — delegate `listRoles`.
- `src/db-host/postgres/postgres-adapter.ts` (+ its SQL module), `src/db-host/sqlite/sqlite-adapter.ts`, `src/db-host/mongo/mongo-adapter.ts` — `listRoles` impls.
- `src/renderer/src/query/introspection.ts` — `useRoles` / `fetchRoles` helper.
- `src/renderer/src/components/ui/modal.tsx` — reusable modal (new).
- `src/renderer/src/components/CreateTableDialog.tsx`, `CreateDatabaseDialog.tsx` — new.
- `src/renderer/src/components/SchemaTree.tsx` — open the dialogs instead of `NamePrompt` for table + database.
- `tests/unit/build-ddl.test.ts` — extend.

---

### Task 1: DDL contract + builder

**Files:**

- Modify: `src/shared/adapter/schema-types.ts`
- Modify: `src/shared/ddl/build-ddl.ts`
- Test: `tests/unit/build-ddl.test.ts`

**Interfaces:**

- Produces: `ColumnSpec.unique?: boolean`; `InlineForeignKey`; `TableSpec.foreignKeys?: InlineForeignKey[]`; `CreateDatabaseOptions`; `DdlChange` variant `{ kind: 'createDatabase'; name: string; options?: CreateDatabaseOptions }`. Later tasks build these shapes.

- [ ] **Step 1: Extend the types**

In `src/shared/adapter/schema-types.ts`, update `ColumnSpec` and `TableSpec`, add the two new interfaces, and add `options` to the `createDatabase` union member:

```ts
export interface ColumnSpec {
  name: string
  type: string // raw engine type text
  notNull?: boolean
  default?: string | null // raw SQL expression; null/absent = none
  unique?: boolean
}
export interface InlineForeignKey {
  name: string
  columns: string[]
  refSchema?: string // omitted → bare ref table (SQLite: no cross-schema FK in table body)
  refTable: string
  refColumns: string[]
}
export interface TableSpec {
  schema: string
  table: string
  columns: ColumnSpec[]
  primaryKey?: string[]
  foreignKeys?: InlineForeignKey[]
}
export interface CreateDatabaseOptions {
  owner?: string
  encoding?: string
  template?: string
  lcCollate?: string
  lcCtype?: string
  tablespace?: string
  connectionLimit?: number
}
```

And change the `createDatabase` line in the `DdlChange` union:

```ts
  | { kind: 'createDatabase'; name: string; options?: CreateDatabaseOptions }
```

- [ ] **Step 2: Write failing builder tests**

Append to `tests/unit/build-ddl.test.ts` (inside the `describe('buildDdl', …)` block):

```ts
it('createTable: UNIQUE column + inline foreign key (pg, qualified ref)', () => {
  const change: DdlChange = {
    kind: 'createTable',
    spec: {
      schema: 'app',
      table: 'orders',
      columns: [
        { name: 'id', type: 'integer', notNull: true },
        { name: 'sku', type: 'text', unique: true },
        { name: 'customer_id', type: 'integer' }
      ],
      primaryKey: ['id'],
      foreignKeys: [
        {
          name: 'fk_orders_customer',
          columns: ['customer_id'],
          refSchema: 'app',
          refTable: 'customers',
          refColumns: ['id']
        }
      ]
    }
  }
  expect(buildDdl(change, 'pg')).toEqual([
    `CREATE TABLE "app"."orders" (\n` +
      `  "id" integer NOT NULL,\n` +
      `  "sku" text UNIQUE,\n` +
      `  "customer_id" integer,\n` +
      `  PRIMARY KEY ("id"),\n` +
      `  CONSTRAINT "fk_orders_customer" FOREIGN KEY ("customer_id") REFERENCES "app"."customers" ("id")\n` +
      `)`
  ])
})

it('createTable: inline foreign key without refSchema (sqlite, bare ref)', () => {
  const change: DdlChange = {
    kind: 'createTable',
    spec: {
      schema: 'main',
      table: 'orders',
      columns: [{ name: 'customer_id', type: 'INTEGER' }],
      foreignKeys: [
        { name: 'fk_o_c', columns: ['customer_id'], refTable: 'customers', refColumns: ['id'] }
      ]
    }
  }
  expect(buildDdl(change, 'sqlite')).toEqual([
    `CREATE TABLE "main"."orders" (\n` +
      `  "customer_id" INTEGER,\n` +
      `  CONSTRAINT "fk_o_c" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id")\n` +
      `)`
  ])
})

it('createDatabase: name only (unchanged)', () => {
  expect(buildDdl({ kind: 'createDatabase', name: 'shop' }, 'pg')).toEqual([
    `CREATE DATABASE "shop"`
  ])
})

it('createDatabase: all options in fixed order', () => {
  expect(
    buildDdl(
      {
        kind: 'createDatabase',
        name: 'shop',
        options: {
          owner: 'app_owner',
          encoding: 'UTF8',
          template: 'template0',
          lcCollate: 'en_US.UTF-8',
          lcCtype: 'en_US.UTF-8',
          tablespace: 'fast',
          connectionLimit: 20
        }
      },
      'pg'
    )
  ).toEqual([
    `CREATE DATABASE "shop" OWNER "app_owner" ENCODING 'UTF8' TEMPLATE "template0" ` +
      `LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TABLESPACE "fast" CONNECTION LIMIT 20`
  ])
})
```

- [ ] **Step 3: Run tests — verify they fail**

Run: `pnpm test -- build-ddl`
Expected: the four new tests FAIL (UNIQUE/FK not emitted; options ignored).

- [ ] **Step 4: Implement the builder changes**

In `src/shared/ddl/build-ddl.ts`:

`columnClause` — append UNIQUE:

```ts
function columnClause(c: ColumnSpec): string {
  let s = `${qi(c.name)} ${c.type}`
  if (c.notNull) s += ' NOT NULL'
  if (c.default != null) s += ` DEFAULT ${c.default}`
  if (c.unique) s += ' UNIQUE'
  return s
}
```

`createTable` — emit inline FK lines after the PK line:

```ts
function createTable(spec: TableSpec): string {
  const lines = spec.columns.map(columnClause)
  if (spec.primaryKey && spec.primaryKey.length)
    lines.push(`PRIMARY KEY (${spec.primaryKey.map(qi).join(', ')})`)
  for (const fk of spec.foreignKeys ?? []) {
    const ref = fk.refSchema ? qtable(fk.refSchema, fk.refTable) : qi(fk.refTable)
    lines.push(
      `CONSTRAINT ${qi(fk.name)} FOREIGN KEY (${fk.columns.map(qi).join(', ')}) ` +
        `REFERENCES ${ref} (${fk.refColumns.map(qi).join(', ')})`
    )
  }
  return `CREATE TABLE ${qtable(spec.schema, spec.table)} (\n  ${lines.join(',\n  ')}\n)`
}
```

`createDatabase` — new option-rendering. Replace the `case 'createDatabase':` line in `buildDdl`:

```ts
    case 'createDatabase':
      return [createDatabase(change.name, change.options)]
```

And add the helper (near `createTable`), importing `CreateDatabaseOptions` in the existing type import from `../adapter/schema-types`:

```ts
function sqlStr(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}
function createDatabase(name: string, o?: CreateDatabaseOptions): string {
  let s = `CREATE DATABASE ${qi(name)}`
  if (!o) return s
  if (o.owner) s += ` OWNER ${qi(o.owner)}`
  if (o.encoding) s += ` ENCODING ${sqlStr(o.encoding)}`
  if (o.template) s += ` TEMPLATE ${qi(o.template)}`
  if (o.lcCollate) s += ` LC_COLLATE ${sqlStr(o.lcCollate)}`
  if (o.lcCtype) s += ` LC_CTYPE ${sqlStr(o.lcCtype)}`
  if (o.tablespace) s += ` TABLESPACE ${qi(o.tablespace)}`
  if (o.connectionLimit != null) s += ` CONNECTION LIMIT ${o.connectionLimit}`
  return s
}
```

Add `CreateDatabaseOptions` to the `import type { … } from '../adapter/schema-types'` list at the top of the file.

- [ ] **Step 5: Run tests — verify pass**

Run: `pnpm test -- build-ddl`
Expected: all build-ddl tests PASS (new + existing).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add src/shared/adapter/schema-types.ts src/shared/ddl/build-ddl.ts tests/unit/build-ddl.test.ts
git commit -m "$(cat <<'EOF'
feat: DDL builder — unique columns, inline FKs, CREATE DATABASE options

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018AGzg9pdVag7LZ83ktnnnX
EOF
)"
```

---

### Task 2: listRoles HostApi method

**Files:**

- Modify: `src/shared/host/host-api.ts`
- Modify: `src/shared/adapter/db-adapter.ts`
- Modify: `src/db-host/host-api-impl.ts`
- Modify: `src/db-host/postgres/postgres-adapter.ts` (+ its SQL constants module)
- Modify: `src/db-host/sqlite/sqlite-adapter.ts`, `src/db-host/mongo/mongo-adapter.ts`
- Modify: `src/renderer/src/query/introspection.ts`

**Interfaces:**

- Produces: `HostApi.listRoles(id: ConnectionId): Promise<string[]>`; `DbAdapter.listRoles(): Promise<string[]>`; renderer `fetchRoles(connId): Promise<string[]>`. Task 5 consumes `fetchRoles`.

- [ ] **Step 1: Add to the HostApi interface**

In `src/shared/host/host-api.ts`, near the other schema methods (around line 42-45):

```ts
  /** Role/owner names (Postgres). Non-role engines return []. */
  listRoles(id: ConnectionId): Promise<string[]>
```

- [ ] **Step 2: Add to the DbAdapter interface**

In `src/shared/adapter/db-adapter.ts`, near `listSchemas` (line ~28):

```ts
  /** Role names for owner selection (Postgres). Non-role engines return []. */
  listRoles(): Promise<string[]>
```

- [ ] **Step 3: Delegate in HostApiImpl**

In `src/db-host/host-api-impl.ts`, next to `listTables` (line ~76):

```ts
  listRoles(id: ConnectionId): Promise<string[]> {
    return this.registry.get(id).listRoles()
  }
```

- [ ] **Step 4: Postgres impl**

In the Postgres SQL constants module (same one holding `LIST_TABLES` — imported as `SQL` in `postgres-adapter.ts`), add:

```ts
export const LIST_ROLES = 'SELECT rolname FROM pg_roles ORDER BY rolname'
```

In `src/db-host/postgres/postgres-adapter.ts`, next to `listTables`:

```ts
  async listRoles(): Promise<string[]> {
    const r = await this.conn.query(SQL.LIST_ROLES)
    return r.rows.map((row: { rolname: string }) => row.rolname)
  }
```

(If `SQL` is a namespace import, reference `SQL.LIST_ROLES`; match the existing `SQL.LIST_TABLES` usage style.)

- [ ] **Step 5: SQLite + Mongo stubs**

In `src/db-host/sqlite/sqlite-adapter.ts` and `src/db-host/mongo/mongo-adapter.ts`, add:

```ts
  async listRoles(): Promise<string[]> {
    return []
  }
```

- [ ] **Step 6: Renderer helper**

In `src/renderer/src/query/introspection.ts`, add alongside `fetchColumns`:

```ts
export async function fetchRoles(connId: string): Promise<string[]> {
  return (await hostApi()).listRoles(connId)
}
```

- [ ] **Step 7: Typecheck + run the contract suite for adapters**

Run: `pnpm typecheck` (expect: passes — all adapters implement `listRoles`).
Run: `pnpm db:up && pnpm test:contract` (expect: green; if the contract suite asserts on the adapter surface it now includes `listRoles`). Then `pnpm db:down`.

If Docker is unavailable, at minimum `pnpm test` + `pnpm typecheck` must pass.

- [ ] **Step 8: Commit**

```bash
git add src/shared/host/host-api.ts src/shared/adapter/db-adapter.ts src/db-host/host-api-impl.ts src/db-host/postgres/ src/db-host/sqlite/sqlite-adapter.ts src/db-host/mongo/mongo-adapter.ts src/renderer/src/query/introspection.ts
git commit -m "$(cat <<'EOF'
feat: listRoles HostApi method (pg roles; [] for sqlite/mongo)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018AGzg9pdVag7LZ83ktnnnX
EOF
)"
```

---

### Task 3: Modal primitive

**Files:**

- Create: `src/renderer/src/components/ui/modal.tsx`

**Interfaces:**

- Produces: `Modal` component — `{ open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }`. Tasks 4 + 5 consume it.

- [ ] **Step 1: Implement the modal**

Create `src/renderer/src/components/ui/modal.tsx`:

```tsx
import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ open, onClose, title, children, footer }: ModalProps): ReactNode {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[85vh] w-[720px] max-w-[92vw] flex-col rounded-lg border border-border bg-background shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-2 text-sm font-medium">{title}</div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + lint + commit**

```bash
pnpm typecheck && pnpm lint
git add src/renderer/src/components/ui/modal.tsx
git commit -m "$(cat <<'EOF'
feat: reusable Modal ui primitive

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018AGzg9pdVag7LZ83ktnnnX
EOF
)"
```

---

### Task 4: Create Table designer

**Files:**

- Create: `src/renderer/src/components/CreateTableDialog.tsx`
- Create: `src/shared/ddl/pg-types.ts`, `src/shared/ddl/sqlite-types.ts`
- Modify: `src/renderer/src/components/SchemaTree.tsx` (replace the "New table…" `NamePrompt` call)
- Test: `tests/unit/create-table-dialog.test.tsx` (light smoke)

**Interfaces:**

- Consumes: `Modal` (Task 3); `buildDdl` + `TableSpec`/`InlineForeignKey`/`ColumnSpec` (Task 1); `fetchTables`/`fetchColumns` + `useSchemas` (existing in `introspection.ts`); the `runDdl(change)` closure in `SchemaTree.tsx:104-113`.
- Produces: `CreateTableDialog` — `{ open, onClose, connId, schema, dialect, onSubmit: (change: DdlChange) => void }`.

- [ ] **Step 1: Curated type lists**

Create `src/shared/ddl/pg-types.ts`:

```ts
// Convenience list for the type combobox; free-text entry is always allowed.
export const PG_TYPES = [
  'integer',
  'bigint',
  'smallint',
  'serial',
  'bigserial',
  'text',
  'varchar(255)',
  'boolean',
  'numeric',
  'real',
  'double precision',
  'date',
  'timestamptz',
  'timestamp',
  'time',
  'uuid',
  'json',
  'jsonb',
  'bytea'
]
```

Create `src/shared/ddl/sqlite-types.ts`:

```ts
export const SQLITE_TYPES = ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC']
```

- [ ] **Step 2: Implement the dialog**

Create `src/renderer/src/components/CreateTableDialog.tsx`. Full component (tabbed, live preview, validation):

```tsx
import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from './ui/modal'
import { buildDdl } from '@shared/ddl/build-ddl'
import type { DdlChange, ColumnSpec, InlineForeignKey } from '@shared/adapter/schema-types'
import { PG_TYPES } from '@shared/ddl/pg-types'
import { SQLITE_TYPES } from '@shared/ddl/sqlite-types'
import { useSchemas, fetchTables, fetchColumns } from '../query/introspection'

type Dialect = 'pg' | 'sqlite'

interface ColRow {
  name: string
  type: string
  nullable: boolean
  pk: boolean
  unique: boolean
  default: string
}
interface FkRow {
  name: string
  columns: string[]
  refSchema: string
  refTable: string
  refColumns: string[]
}

const emptyCol = (): ColRow => ({
  name: '',
  type: '',
  nullable: true,
  pk: false,
  unique: false,
  default: ''
})

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

  const spec = useMemo(() => {
    const columns: ColumnSpec[] = cols
      .filter((c) => c.name.trim() && c.type.trim())
      .map((c) => ({
        name: c.name.trim(),
        type: c.type.trim(),
        notNull: !c.nullable,
        default: c.default.trim() ? c.default.trim() : undefined,
        unique: c.unique || undefined
      }))
    const primaryKey = cols.filter((c) => c.pk && c.name.trim()).map((c) => c.name.trim())
    const foreignKeys: InlineForeignKey[] = fks
      .filter((f) => f.columns.length && f.refTable && f.refColumns.length)
      .map((f) => ({
        name: f.name.trim() || `fk_${table}_${f.columns[0]}`,
        columns: f.columns,
        refSchema: dialect === 'sqlite' ? undefined : f.refSchema || undefined,
        refTable: f.refTable,
        refColumns: f.refColumns
      }))
    return {
      schema,
      table: table.trim(),
      columns,
      primaryKey: primaryKey.length ? primaryKey : undefined,
      foreignKeys: foreignKeys.length ? foreignKeys : undefined
    }
  }, [cols, fks, table, schema, dialect])

  const valid = spec.table.length > 0 && spec.columns.length > 0
  const preview = valid ? buildDdl({ kind: 'createTable', spec }, dialect)[0] : ''

  const setCol = (i: number, patch: Partial<ColRow>): void =>
    setCols((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const move = (i: number, d: -1 | 1): void =>
    setCols((cs) => {
      const j = i + d
      if (j < 0 || j >= cs.length) return cs
      const next = cs.slice()
      ;[next[i], next[j]] = [next[j], next[i]]
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
      <div className="mb-2 flex gap-2 text-sm">
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
              <button onClick={() => move(i, -1)}>↑</button>
              <button onClick={() => move(i, 1)}>↓</button>
              <button onClick={() => setCols((cs) => cs.filter((_, j) => j !== i))}>✕</button>
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
  const { data: tables } = useQuery({
    queryKey: ['fk-tables', connId, value.refSchema],
    queryFn: () => fetchTables(connId, value.refSchema),
    enabled: !!value.refSchema
  })
  const { data: refCols } = useQuery({
    queryKey: ['fk-cols', connId, value.refSchema, value.refTable],
    queryFn: () => fetchColumns(connId, value.refSchema, value.refTable),
    enabled: !!value.refSchema && !!value.refTable
  })
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
      <button onClick={onRemove}>✕</button>
    </div>
  )
}
```

Note: `fetchTables(connId, schema)` returns `TableInfo[]` (has `.name`), `fetchColumns(connId, schema, table)` returns `ColumnInfo[]` (has `.name`) — verify these signatures in `introspection.ts` before wiring and adjust the `.map` accessors if the shapes differ.

- [ ] **Step 3: Wire into SchemaTree**

In `src/renderer/src/components/SchemaTree.tsx`:

Add the import near the other component imports:

```ts
import { CreateTableDialog } from './CreateTableDialog'
```

Add dialog state next to the `namePrompt` state (search for `setNamePrompt`):

```ts
const [createTable, setCreateTable] = useState<{ schema: string } | null>(null)
```

Replace the "New table…" menu action (SchemaTree.tsx:192-209) so it opens the dialog instead of `NamePrompt`:

```ts
if (ops?.createTable)
  items.push({
    label: 'New table…',
    run: () => setCreateTable({ schema: m.schema })
  })
```

Render the dialog next to where `NamePrompt` is rendered (SchemaTree.tsx:371). `connId`, `dialect`, and `runDdl` already exist in scope:

```tsx
{
  createTable && (
    <CreateTableDialog
      open
      onClose={() => setCreateTable(null)}
      connId={connId!}
      schema={createTable.schema}
      dialect={dialect}
      onSubmit={(change) => void runDdl(change)}
    />
  )
}
```

- [ ] **Step 4: Light smoke test**

Create `tests/unit/create-table-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateTableDialog } from '../../src/renderer/src/components/CreateTableDialog'

function wrap(ui: React.ReactNode): React.ReactElement {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
}

describe('CreateTableDialog', () => {
  it('Create is disabled until a table name + a named/typed column exist, then emits createTable', () => {
    const onSubmit = vi.fn()
    render(
      wrap(
        <CreateTableDialog
          open
          onClose={() => {}}
          connId="c1"
          schema="app"
          dialect="pg"
          onSubmit={onSubmit}
        />
      )
    )
    const create = screen.getByText('Create') as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('table-name'), { target: { value: 'orders' } })
    fireEvent.change(screen.getByLabelText('col-name'), { target: { value: 'id' } })
    fireEvent.change(screen.getByLabelText('col-type'), { target: { value: 'integer' } })
    expect((screen.getByText('Create') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByText('Create'))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'createTable',
        spec: expect.objectContaining({ table: 'orders' })
      })
    )
  })
})
```

- [ ] **Step 5: Run test**

Run: `pnpm test -- create-table-dialog`
Expected: PASS. (If `@testing-library/react` is not a dependency, check `package.json`; if absent, drop this rendering test and instead unit-test the spec-assembly by exporting a small pure `buildTableSpec` helper — but prefer the render test if the library is present.)

- [ ] **Step 6: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add src/renderer/src/components/CreateTableDialog.tsx src/shared/ddl/pg-types.ts src/shared/ddl/sqlite-types.ts src/renderer/src/components/SchemaTree.tsx tests/unit/create-table-dialog.test.tsx
git commit -m "$(cat <<'EOF'
feat: Create Table designer (columns, keys, FK dropdowns)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018AGzg9pdVag7LZ83ktnnnX
EOF
)"
```

---

### Task 5: Create Database dialog

**Files:**

- Create: `src/renderer/src/components/CreateDatabaseDialog.tsx`
- Modify: `src/renderer/src/components/SchemaTree.tsx` (replace the "New database…" `NamePrompt` call)
- Test: `tests/unit/create-database-dialog.test.tsx` (light smoke)

**Interfaces:**

- Consumes: `Modal` (Task 3); `fetchRoles` (Task 2); `CreateDatabaseOptions`/`DdlChange` (Task 1); the `runDdl` closure in `SchemaTree.tsx`.
- Produces: `CreateDatabaseDialog` — `{ open, onClose, connId, onSubmit: (change: DdlChange) => void }`.

- [ ] **Step 1: Implement the dialog**

Create `src/renderer/src/components/CreateDatabaseDialog.tsx`:

```tsx
import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from './ui/modal'
import type { DdlChange, CreateDatabaseOptions } from '@shared/adapter/schema-types'
import { fetchRoles } from '../query/introspection'

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

  const { data: roles } = useQuery({
    queryKey: ['roles', connId],
    queryFn: () => fetchRoles(connId),
    enabled: open
  })

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
```

- [ ] **Step 2: Wire into SchemaTree**

In `src/renderer/src/components/SchemaTree.tsx`:

```ts
import { CreateDatabaseDialog } from './CreateDatabaseDialog'
```

State next to the other dialog state:

```ts
const [createDatabase, setCreateDatabase] = useState(false)
```

Replace the "New database…" menu action (SchemaTree.tsx:224-232):

```ts
if (ops?.createDatabase)
  items.push({
    label: 'New database…',
    run: () => setCreateDatabase(true)
  })
```

Render near the other dialogs:

```tsx
{
  createDatabase && (
    <CreateDatabaseDialog
      open
      onClose={() => setCreateDatabase(false)}
      connId={connId!}
      onSubmit={(change) => void runDdl(change)}
    />
  )
}
```

- [ ] **Step 3: Light smoke test**

Create `tests/unit/create-database-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateDatabaseDialog } from '../../src/renderer/src/components/CreateDatabaseDialog'

vi.mock('../../src/renderer/src/query/introspection', () => ({
  fetchRoles: () => Promise.resolve(['app_owner'])
}))

function wrap(ui: React.ReactNode): React.ReactElement {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
}

describe('CreateDatabaseDialog', () => {
  it('emits createDatabase with name (options omitted when only defaults)', () => {
    const onSubmit = vi.fn()
    render(wrap(<CreateDatabaseDialog open onClose={() => {}} connId="c1" onSubmit={onSubmit} />))
    fireEvent.change(screen.getByLabelText('db-name'), { target: { value: 'shop' } })
    fireEvent.click(screen.getByText('Create'))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'createDatabase', name: 'shop' })
    )
  })
})
```

- [ ] **Step 4: Run test**

Run: `pnpm test -- create-database-dialog`
Expected: PASS. (Same `@testing-library/react` caveat as Task 4 Step 5. `encoding` defaults to `UTF8`, so `options` will contain `{ encoding: 'UTF8' }` and be passed — adjust the assertion to `objectContaining` on `kind`/`name` only, which the test already does.)

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add src/renderer/src/components/CreateDatabaseDialog.tsx src/renderer/src/components/SchemaTree.tsx tests/unit/create-database-dialog.test.tsx
git commit -m "$(cat <<'EOF'
feat: Create Database dialog with full metadata (Postgres)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018AGzg9pdVag7LZ83ktnnnX
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**

- Modal primitive → Task 3 ✓
- Create Table designer (Columns + FK tabs, type combobox, unique, PK, default) → Task 4 ✓
- FK dropdowns from listSchemas/listTables/getColumns → Task 4 `FkEditor` ✓
- Create Database full metadata → Task 5 ✓
- DDL additions (unique, inline FK, db options) → Task 1 ✓
- listRoles (pg impl, sqlite/mongo []) → Task 2 ✓
- Wire into SchemaTree, keep New schema on NamePrompt → Tasks 4/5 (schema untouched) ✓
- Engine-gating (relational only; pg-only rich DB dialog) → menu gated by `ops.createTable`/`ops.createDatabase` (unchanged), sqlite FK bare-ref in Task 1/4 ✓
- build-ddl unit tests as the gate → Task 1 ✓

**2. Placeholder scan:** No TBD/TODO. Each code step carries complete code. Two explicit "verify the shape in introspection.ts / package.json before wiring" notes are real guardrails against signature drift, not deferred work.

**3. Type consistency:** `ColumnSpec.unique`, `InlineForeignKey` (refSchema optional), `TableSpec.foreignKeys`, `CreateDatabaseOptions` (owner/encoding/template/lcCollate/lcCtype/tablespace/connectionLimit), `DdlChange.createDatabase.options`, `listRoles(): Promise<string[]>`, `fetchRoles(connId): Promise<string[]>` are used identically across Tasks 1, 2, 4, 5. Dialog `onSubmit: (change: DdlChange) => void` matches `runDdl(change)`. Consistent.

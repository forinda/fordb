# fordb MA3a — Structure Page + Additive DDL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inspect a table's structure (columns/keys/indexes + reconstructed DDL) and perform additive schema changes — generated → previewed → applied — from a dedicated Structure tab. Postgres full; SQLite for its non-rebuild ops.

**Architecture:** A `SchemaEditor` adapter capability (`ops` flags + `applyDdl(statements)`) mirrors `dataMutator`/`dataBrowser`. DDL is produced by a pure `buildDdl(change, dialect)` in the renderer, previewed, then the final statements cross to the host for a transactional apply. The engine advertises `SchemaOps` so the UI offers only valid actions.

**Tech Stack:** TypeScript strict, `pg`, `@libsql/client`, React 19, Zustand, TanStack Query, vitest, Playwright.

## Global Constraints

- pnpm; Node >= 22; TypeScript strict; no `any` except typed casts at the RPC/DB boundary.
- Identifiers quoted via `quoteIdent` (`@shared/mutation/build-edits`, `"`-doubling). Column **types** and **DEFAULT** expressions are raw SQL text by design (a type/default _is_ a SQL fragment) — mitigated by mandatory preview + explicit confirm; DDL is a privileged, local, authenticated action, never a bound-value path.
- Every DDL op (especially every `DROP …`) shows the generated SQL and requires explicit confirm before apply (repo-wide rule).
- Capability-gated (`adapter.schemaEditor`): PG all ops; SQLite = `createTable, addColumn, createIndex, dropIndex, dropTable`. UI reads `SchemaOps` and only offers supported actions; `host-api-impl` throws defensively if an unsupported path is called.
- Apply is transactional where the engine allows (PG `BEGIN…COMMIT` on a dedicated `pg.Client`; SQLite `batch(…, 'write')`). PG `CREATE/DROP DATABASE` cannot run in a txn → single-statement bypass.
- After a successful apply, invalidate the connection's introspection cache (tree + structure view refresh).
- Secrets never reach the renderer. `@shared/*` alias. Renderer-importing tests → `tsconfig.web`; pure/db-host tests → `tsconfig.node`.
- Each task ends with `pnpm typecheck && pnpm lint && pnpm test` green (+ `pnpm build` for renderer tasks). Contract tasks run `pnpm db:up && pnpm test:contract && pnpm db:down`.
- One PR per task against `main`.

## File Structure (end state)

```
src/shared/adapter/schema-types.ts            # NEW: SchemaOps, ColumnSpec, TableSpec, IndexSpec, ForeignKeySpec, DdlChange, SchemaEditor
src/shared/adapter/db-adapter.ts              # MODIFY: readonly schemaEditor?
src/shared/ddl/build-ddl.ts                   # NEW: buildDdl (pure, pg|sqlite) + reconstructDdl
src/db-host/postgres/postgres-schema.ts       # NEW: PgSchemaEditor
src/db-host/postgres/postgres-adapter.ts      # MODIFY: schemaEditor wiring
src/db-host/sqlite/sqlite-schema.ts           # NEW: SqliteSchemaEditor
src/db-host/sqlite/sqlite-adapter.ts          # MODIFY: schemaEditor wiring
src/shared/host/host-api.ts                   # MODIFY: schemaEditSupported/schemaOps/applyDdl
src/db-host/host-api-impl.ts                  # MODIFY: route them
src/renderer/src/store-query.ts               # MODIFY: 'structure' tab kind + openStructure + applyDdl
src/renderer/src/components/StructureView.tsx # NEW: panels + reconstructed DDL + forms + preview/confirm
src/renderer/src/components/SchemaTree.tsx    # MODIFY: 'Structure' context item + create-table/schema/db entries
src/renderer/src/components/QueryWorkbench.tsx# MODIFY: render StructureView for kind 'structure'
tests/unit/build-ddl.test.ts                  # NEW
tests/contract/adapter-contract.ts            # MODIFY: capability-gated schema-editor block
tests/contract/host-api.contract.test.ts      # MODIFY: applyDdl round-trip
tests/e2e/structure.spec.ts                   # NEW
```

---

### Task 1: SchemaEditor types + capability member

**Files:**

- Create: `src/shared/adapter/schema-types.ts`
- Modify: `src/shared/adapter/db-adapter.ts`

**Interfaces:**

- Produces: `SchemaOps`, `ColumnSpec`, `TableSpec`, `IndexSpec`, `ForeignKeySpec`, `DdlChange`, `SchemaEditor`; `DbAdapter.schemaEditor?`.

- [ ] **Step 1: Types**

`src/shared/adapter/schema-types.ts`:

```ts
export interface SchemaOps {
  createTable: boolean
  addColumn: boolean
  createIndex: boolean
  dropIndex: boolean
  addForeignKey: boolean
  dropForeignKey: boolean
  dropTable: boolean
  createSchema: boolean
  dropSchema: boolean
  createDatabase: boolean
  dropDatabase: boolean
}

export interface ColumnSpec {
  name: string
  type: string // raw engine type text
  notNull?: boolean
  default?: string | null // raw SQL expression; null/absent = none
}
export interface TableSpec {
  schema: string
  table: string
  columns: ColumnSpec[]
  primaryKey?: string[]
}
export interface IndexSpec {
  schema: string
  table: string
  name: string
  columns: string[]
  unique?: boolean
}
export interface ForeignKeySpec {
  schema: string
  table: string
  name: string
  columns: string[]
  refSchema: string
  refTable: string
  refColumns: string[]
}

export type DdlChange =
  | { kind: 'createTable'; spec: TableSpec }
  | { kind: 'addColumn'; schema: string; table: string; column: ColumnSpec }
  | { kind: 'createIndex'; spec: IndexSpec }
  | { kind: 'dropIndex'; schema: string; name: string }
  | { kind: 'addForeignKey'; spec: ForeignKeySpec }
  | { kind: 'dropForeignKey'; schema: string; table: string; name: string }
  | { kind: 'dropTable'; schema: string; table: string }
  | { kind: 'createSchema'; name: string }
  | { kind: 'dropSchema'; name: string }
  | { kind: 'createDatabase'; name: string }
  | { kind: 'dropDatabase'; name: string }

/** Optional structure-editing capability: advertises supported ops and applies
 *  pre-generated, user-previewed DDL statements transactionally. */
export interface SchemaEditor {
  readonly ops: SchemaOps
  applyDdl(statements: string[]): Promise<void>
}
```

- [ ] **Step 2: Capability member**

Modify `src/shared/adapter/db-adapter.ts` — add `import type { SchemaEditor } from './schema-types'` and, after `dataBrowser?`:

```ts
  /** Optional structure/DDL capability (Postgres full; SQLite non-rebuild ops). */
  readonly schemaEditor?: SchemaEditor
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test` (types only; green).

```bash
git add src/shared/adapter/schema-types.ts src/shared/adapter/db-adapter.ts
git commit -m "feat: SchemaEditor types + optional adapter capability"
```

---

### Task 2: Pure `buildDdl` + `reconstructDdl`

**Files:**

- Create: `src/shared/ddl/build-ddl.ts`, `tests/unit/build-ddl.test.ts`

**Interfaces:**

- Consumes: `DdlChange`, `ColumnSpec`, `TableSpec`, `IndexSpec`, `ForeignKeySpec` (Task 1), `quoteIdent` (`@shared/mutation/build-edits`), `ColumnInfo`/`KeyInfo`/`IndexInfo` (`@shared/adapter/types`).
- Produces: `buildDdl(change, dialect: 'pg'|'sqlite'): string[]`; `reconstructDdl(cols, keys, indexes, schema, table, dialect): string`.

- [ ] **Step 1: Failing tests**

`tests/unit/build-ddl.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildDdl, reconstructDdl } from '../../src/shared/ddl/build-ddl'
import type { DdlChange } from '../../src/shared/adapter/schema-types'

describe('buildDdl', () => {
  it('createTable: columns, NOT NULL, DEFAULT, PK', () => {
    const change: DdlChange = {
      kind: 'createTable',
      spec: {
        schema: 'app',
        table: 't',
        columns: [
          { name: 'id', type: 'integer', notNull: true },
          { name: 'name', type: 'text', default: `'x'` }
        ],
        primaryKey: ['id']
      }
    }
    expect(buildDdl(change, 'pg')).toEqual([
      `CREATE TABLE "app"."t" (\n  "id" integer NOT NULL,\n  "name" text DEFAULT 'x',\n  PRIMARY KEY ("id")\n)`
    ])
  })
  it('addColumn', () => {
    const change: DdlChange = {
      kind: 'addColumn',
      schema: 'app',
      table: 't',
      column: { name: 'age', type: 'integer', notNull: true }
    }
    expect(buildDdl(change, 'pg')).toEqual([
      `ALTER TABLE "app"."t" ADD COLUMN "age" integer NOT NULL`
    ])
  })
  it('createIndex (unique) and dropIndex', () => {
    expect(
      buildDdl(
        {
          kind: 'createIndex',
          spec: { schema: 'app', table: 't', name: 'i', columns: ['a', 'b'], unique: true }
        },
        'pg'
      )
    ).toEqual([`CREATE UNIQUE INDEX "i" ON "app"."t" ("a", "b")`])
    expect(buildDdl({ kind: 'dropIndex', schema: 'app', name: 'i' }, 'pg')).toEqual([
      `DROP INDEX "app"."i"`
    ])
  })
  it('sqlite dropIndex omits the schema qualifier', () => {
    expect(buildDdl({ kind: 'dropIndex', schema: 'main', name: 'i' }, 'sqlite')).toEqual([
      `DROP INDEX "i"`
    ])
  })
  it('addForeignKey / dropForeignKey (pg)', () => {
    expect(
      buildDdl(
        {
          kind: 'addForeignKey',
          spec: {
            schema: 'app',
            table: 'orders',
            name: 'orders_user_fk',
            columns: ['user_id'],
            refSchema: 'app',
            refTable: 'users',
            refColumns: ['id']
          }
        },
        'pg'
      )
    ).toEqual([
      `ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_user_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users" ("id")`
    ])
    expect(
      buildDdl(
        { kind: 'dropForeignKey', schema: 'app', table: 'orders', name: 'orders_user_fk' },
        'pg'
      )
    ).toEqual([`ALTER TABLE "app"."orders" DROP CONSTRAINT "orders_user_fk"`])
  })
  it('dropTable / createSchema / dropSchema / createDatabase / dropDatabase', () => {
    expect(buildDdl({ kind: 'dropTable', schema: 'app', table: 't' }, 'pg')).toEqual([
      `DROP TABLE "app"."t"`
    ])
    expect(buildDdl({ kind: 'createSchema', name: 's' }, 'pg')).toEqual([`CREATE SCHEMA "s"`])
    expect(buildDdl({ kind: 'dropSchema', name: 's' }, 'pg')).toEqual([`DROP SCHEMA "s"`])
    expect(buildDdl({ kind: 'createDatabase', name: 'd' }, 'pg')).toEqual([`CREATE DATABASE "d"`])
    expect(buildDdl({ kind: 'dropDatabase', name: 'd' }, 'pg')).toEqual([`DROP DATABASE "d"`])
  })
  it('quotes identifiers with embedded quotes', () => {
    expect(buildDdl({ kind: 'dropTable', schema: 'a"b', table: 't"x' }, 'pg')).toEqual([
      `DROP TABLE "a""b"."t""x"`
    ])
  })
})

describe('reconstructDdl', () => {
  it('renders CREATE TABLE + indexes from introspection', () => {
    const ddl = reconstructDdl(
      [
        { name: 'id', dataType: 'integer', nullable: false, defaultValue: null, ordinal: 1 },
        { name: 'email', dataType: 'text', nullable: false, defaultValue: null, ordinal: 2 }
      ],
      [{ name: 'primary', kind: 'primary', columns: ['id'], referencedTable: null }],
      [{ name: 'users_email_idx', columns: ['email'], unique: true }],
      'app',
      'users',
      'pg'
    )
    expect(ddl).toContain(`CREATE TABLE "app"."users" (`)
    expect(ddl).toContain(`"id" integer NOT NULL`)
    expect(ddl).toContain(`PRIMARY KEY ("id")`)
    expect(ddl).toContain(`CREATE UNIQUE INDEX "users_email_idx" ON "app"."users" ("email")`)
  })
})
```

- [ ] **Step 2: Run → FAIL** — `pnpm vitest run tests/unit/build-ddl.test.ts`.

- [ ] **Step 3: Implement**

`src/shared/ddl/build-ddl.ts`:

```ts
import type { ColumnInfo, IndexInfo, KeyInfo } from '../adapter/types'
import type {
  ColumnSpec,
  DdlChange,
  ForeignKeySpec,
  IndexSpec,
  TableSpec
} from '../adapter/schema-types'
import { quoteIdent } from '../mutation/build-edits'

type Dialect = 'pg' | 'sqlite'

const qi = quoteIdent
// schema.table, or bare table on sqlite where a schema qualifier is 'main'/attached.
const qtable = (schema: string, table: string): string => `${qi(schema)}.${qi(table)}`

function columnClause(c: ColumnSpec): string {
  let s = `${qi(c.name)} ${c.type}`
  if (c.notNull) s += ' NOT NULL'
  if (c.default != null) s += ` DEFAULT ${c.default}`
  return s
}

function createTable(spec: TableSpec): string {
  const lines = spec.columns.map(columnClause)
  if (spec.primaryKey && spec.primaryKey.length)
    lines.push(`PRIMARY KEY (${spec.primaryKey.map(qi).join(', ')})`)
  return `CREATE TABLE ${qtable(spec.schema, spec.table)} (\n  ${lines.join(',\n  ')}\n)`
}

function createIndex(spec: IndexSpec): string {
  const u = spec.unique ? 'UNIQUE ' : ''
  return `CREATE ${u}INDEX ${qi(spec.name)} ON ${qtable(spec.schema, spec.table)} (${spec.columns
    .map(qi)
    .join(', ')})`
}

function addForeignKey(spec: ForeignKeySpec): string {
  return (
    `ALTER TABLE ${qtable(spec.schema, spec.table)} ADD CONSTRAINT ${qi(spec.name)} ` +
    `FOREIGN KEY (${spec.columns.map(qi).join(', ')}) ` +
    `REFERENCES ${qtable(spec.refSchema, spec.refTable)} (${spec.refColumns.map(qi).join(', ')})`
  )
}

export function buildDdl(change: DdlChange, dialect: Dialect): string[] {
  switch (change.kind) {
    case 'createTable':
      return [createTable(change.spec)]
    case 'addColumn':
      return [
        `ALTER TABLE ${qtable(change.schema, change.table)} ADD COLUMN ${columnClause(change.column)}`
      ]
    case 'createIndex':
      return [createIndex(change.spec)]
    case 'dropIndex':
      // SQLite indexes live in the (single) schema namespace; a qualifier errors.
      return [
        dialect === 'sqlite'
          ? `DROP INDEX ${qi(change.name)}`
          : `DROP INDEX ${qtable(change.schema, change.name)}`
      ]
    case 'addForeignKey':
      return [addForeignKey(change.spec)]
    case 'dropForeignKey':
      return [
        `ALTER TABLE ${qtable(change.schema, change.table)} DROP CONSTRAINT ${qi(change.name)}`
      ]
    case 'dropTable':
      return [`DROP TABLE ${qtable(change.schema, change.table)}`]
    case 'createSchema':
      return [`CREATE SCHEMA ${qi(change.name)}`]
    case 'dropSchema':
      return [`DROP SCHEMA ${qi(change.name)}`]
    case 'createDatabase':
      return [`CREATE DATABASE ${qi(change.name)}`]
    case 'dropDatabase':
      return [`DROP DATABASE ${qi(change.name)}`]
  }
}

export function reconstructDdl(
  cols: ColumnInfo[],
  keys: KeyInfo[],
  indexes: IndexInfo[],
  schema: string,
  table: string,
  dialect: Dialect
): string {
  const pk = keys.find((k) => k.kind === 'primary')
  const create = createTable({
    schema,
    table,
    columns: cols
      .slice()
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((c) => ({
        name: c.name,
        type: c.dataType,
        notNull: !c.nullable,
        default: c.defaultValue
      })),
    primaryKey: pk?.columns
  })
  const idxLines = indexes
    // The PK's backing index is implied by PRIMARY KEY (…); don't re-emit it.
    .filter((i) => !(pk && i.columns.join(',') === pk.columns.join(',') && i.unique))
    .map((i) => createIndex({ schema, table, name: i.name, columns: i.columns, unique: i.unique }))
  return [create + ';', ...idxLines.map((l) => l + ';')].join('\n')
}
```

- [ ] **Step 4: Run → PASS + commit**

Run: `pnpm vitest run tests/unit/build-ddl.test.ts`, then `pnpm typecheck && pnpm lint`.

```bash
git add src/shared/ddl/build-ddl.ts tests/unit/build-ddl.test.ts
git commit -m "feat: pure buildDdl + reconstructDdl (pg/sqlite, quoted idents)"
```

---

### Task 3: PgSchemaEditor + contract

**Files:**

- Create: `src/db-host/postgres/postgres-schema.ts`
- Modify: `src/db-host/postgres/postgres-adapter.ts`, `tests/contract/adapter-contract.ts`

**Interfaces:**

- Consumes: `SchemaEditor`, `SchemaOps`, a `() => pg.Client` factory (same as `PgDataMutator`).
- Produces: `PgSchemaEditor`; `PostgresAdapter.schemaEditor`.

- [ ] **Step 1: PgSchemaEditor**

`src/db-host/postgres/postgres-schema.ts`:

```ts
import type pg from 'pg'
import type { SchemaEditor, SchemaOps } from '@shared/adapter/schema-types'

const PG_OPS: SchemaOps = {
  createTable: true,
  addColumn: true,
  createIndex: true,
  dropIndex: true,
  addForeignKey: true,
  dropForeignKey: true,
  dropTable: true,
  createSchema: true,
  dropSchema: true,
  createDatabase: true,
  dropDatabase: true
}

// CREATE/DROP DATABASE cannot run inside a transaction block.
const isDatabaseStmt = (s: string): boolean => /^\s*(CREATE|DROP)\s+DATABASE\b/i.test(s)

export class PgSchemaEditor implements SchemaEditor {
  readonly ops = PG_OPS
  // Dedicated client per apply (same rationale as PgDataMutator: never queue a
  // transaction behind an open query/browse cursor on the shared connection).
  constructor(private readonly makeClient: () => pg.Client) {}

  async applyDdl(statements: string[]): Promise<void> {
    if (statements.length === 0) return
    const client = this.makeClient()
    await client.connect()
    try {
      const inTxn = !statements.some(isDatabaseStmt)
      if (inTxn) await client.query('BEGIN')
      try {
        for (const s of statements) await client.query(s)
        if (inTxn) await client.query('COMMIT')
      } catch (err) {
        if (inTxn) await client.query('ROLLBACK').catch(() => {})
        throw err
      }
    } finally {
      await client.end()
    }
  }
}
```

- [ ] **Step 2: Wire onto the adapter**

In `postgres-adapter.ts`: import `PgSchemaEditor` + `SchemaEditor`, add next to `dataBrowser` (reuse the same client factory the mutator uses):

```ts
  readonly schemaEditor: SchemaEditor = new PgSchemaEditor(() => {
    if (!this.profile) throw new Error('Not connected')
    return new pg.Client(PostgresAdapter.clientConfig(this.profile))
  })
```

- [ ] **Step 3: Capability-gated contract test**

In `tests/contract/adapter-contract.ts`, add AFTER the browse test and BEFORE the mutator test (so it precedes the last, mutating test; it uses its own throwaway table so it doesn't touch the shared fixture rows):

```ts
it('schema editor: create/add-column/index/fk then drop — introspection reflects each', async () => {
  if (!adapter.schemaEditor) return
  const s = expected.schema
  const ddl = (stmts: string[]): Promise<void> => adapter.schemaEditor!.applyDdl(stmts)
  // create table
  await ddl([`CREATE TABLE ${q(s)}.${q('ma3_t')} ("id" integer NOT NULL, PRIMARY KEY ("id"))`])
  expect((await adapter.listTables(s)).some((t) => t.name === 'ma3_t')).toBe(true)
  // add column
  await ddl([`ALTER TABLE ${q(s)}.${q('ma3_t')} ADD COLUMN ${q('label')} text`])
  expect((await adapter.getColumns(s, 'ma3_t')).some((c) => c.name === 'label')).toBe(true)
  // create index
  await ddl([`CREATE INDEX ${q('ma3_idx')} ON ${q(s)}.${q('ma3_t')} (${q('label')})`])
  expect((await adapter.getIndexes(s, 'ma3_t')).some((i) => i.name === 'ma3_idx')).toBe(true)
  // add FK (only if the engine advertises it)
  if (adapter.schemaEditor.ops.addForeignKey) {
    await ddl([
      `ALTER TABLE ${q(s)}.${q('ma3_t')} ADD CONSTRAINT ${q('ma3_fk')} FOREIGN KEY (${q('id')}) REFERENCES ${q(s)}.${q('users')} (${q('id')})`
    ])
    expect((await adapter.getKeys(s, 'ma3_t')).some((k) => k.kind === 'foreign')).toBe(true)
  }
  // drop table (cleans up)
  await ddl([`DROP TABLE ${q(s)}.${q('ma3_t')}`])
  expect((await adapter.listTables(s)).some((t) => t.name === 'ma3_t')).toBe(false)
})
```

Add a local `const q = (id: string): string => \`"${id.replace(/"/g, '""')}"\``near the top of the contract's`describe` if one is not already present (check first; the mutator/browse tests may already define a quoting helper — reuse it, do not duplicate).

- [ ] **Step 4: Run + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm db:up && pnpm test:contract && pnpm db:down`.

```bash
git add src/db-host/postgres/postgres-schema.ts src/db-host/postgres/postgres-adapter.ts tests/contract/adapter-contract.ts
git commit -m "feat: PgSchemaEditor (transactional DDL apply) + contract"
```

---

### Task 4: SqliteSchemaEditor + contract coverage

**Files:**

- Create: `src/db-host/sqlite/sqlite-schema.ts`
- Modify: `src/db-host/sqlite/sqlite-adapter.ts`

**Interfaces:**

- Consumes: `SchemaEditor`, `SchemaOps`, a `() => Client` accessor (the adapter's `conn`).
- Produces: `SqliteSchemaEditor`; `SqliteAdapter.schemaEditor`.

- [ ] **Step 1: SqliteSchemaEditor**

`src/db-host/sqlite/sqlite-schema.ts`:

```ts
import type { Client } from '@libsql/client'
import type { SchemaEditor, SchemaOps } from '@shared/adapter/schema-types'

// SQLite can do these without a table rebuild. FK/schema/database ops and
// in-place column changes need a rebuild → deferred to MA3b, advertised false.
const SQLITE_OPS: SchemaOps = {
  createTable: true,
  addColumn: true,
  createIndex: true,
  dropIndex: true,
  dropTable: true,
  addForeignKey: false,
  dropForeignKey: false,
  createSchema: false,
  dropSchema: false,
  createDatabase: false,
  dropDatabase: false
}

export class SqliteSchemaEditor implements SchemaEditor {
  readonly ops = SQLITE_OPS
  constructor(private readonly conn: () => Client) {}

  async applyDdl(statements: string[]): Promise<void> {
    if (statements.length === 0) return
    // batch(_, 'write') wraps the statements in a single write transaction.
    await this.conn().batch(statements, 'write')
  }
}
```

- [ ] **Step 2: Wire onto the adapter**

In `sqlite-adapter.ts`: import `SqliteSchemaEditor` + `SchemaEditor`, add next to `dataBrowser`:

```ts
  readonly schemaEditor: SchemaEditor = new SqliteSchemaEditor(() => this.conn)
```

- [ ] **Step 3: Run the schema contract for SQLite + commit**

The Task-3 contract test is capability-gated and only exercises FK when `ops.addForeignKey` is true, so it runs for SQLite (create/add-column/index/drop) and skips the FK step. Run: `pnpm db:up && pnpm test:contract && pnpm db:down`, then `pnpm typecheck && pnpm lint && pnpm test`.

```bash
git add src/db-host/sqlite/sqlite-schema.ts src/db-host/sqlite/sqlite-adapter.ts
git commit -m "feat: SqliteSchemaEditor (batch DDL apply, non-rebuild ops) + contract coverage"
```

---

### Task 5: HostApi schema-editor surface + routing

**Files:**

- Modify: `src/shared/host/host-api.ts`, `src/db-host/host-api-impl.ts`, `tests/contract/host-api.contract.test.ts`

**Interfaces:**

- Produces: `HostApi.schemaEditSupported(id)`, `HostApi.schemaOps(id)`, `HostApi.applyDdl(id, statements)`.

- [ ] **Step 1: Interface**

Modify `src/shared/host/host-api.ts`: `import type { SchemaOps } from '../adapter/schema-types'`, add after `openBrowse`:

```ts
  schemaEditSupported(id: ConnectionId): Promise<boolean>
  schemaOps(id: ConnectionId): Promise<SchemaOps>
  applyDdl(id: ConnectionId, statements: string[]): Promise<void>
```

- [ ] **Step 2: Routing**

Modify `src/db-host/host-api-impl.ts`: import `SchemaEditor`, `SchemaOps`, add:

```ts
  private schema(id: ConnectionId): SchemaEditor {
    const e = this.registry.get(id).schemaEditor
    if (!e) throw new Error('Structure editing is not supported by this engine')
    return e
  }
  async schemaEditSupported(id: ConnectionId): Promise<boolean> {
    return this.registry.get(id).schemaEditor != null
  }
  async schemaOps(id: ConnectionId): Promise<SchemaOps> {
    return this.schema(id).ops
  }
  applyDdl(id: ConnectionId, statements: string[]): Promise<void> {
    return this.schema(id).applyDdl(statements)
  }
```

- [ ] **Step 3: host-api contract assertion**

In `tests/contract/host-api.contract.test.ts`, add:

```ts
it('applies DDL over the HostApi (create + drop a temp table)', async () => {
  const id = await client.openConnection(profile)
  expect(await client.schemaEditSupported(id)).toBe(true)
  const ops = await client.schemaOps(id)
  expect(ops.createTable).toBe(true)
  await client.applyDdl(id, [
    `CREATE TABLE app.ma3_hostapi ("id" integer NOT NULL, PRIMARY KEY ("id"))`
  ])
  expect((await client.listTables(id, 'app')).some((t) => t.name === 'ma3_hostapi')).toBe(true)
  await client.applyDdl(id, [`DROP TABLE app.ma3_hostapi`])
  await client.closeConnection(id)
})
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm db:up && pnpm test:contract && pnpm db:down`.

```bash
git add src/shared/host/host-api.ts src/db-host/host-api-impl.ts tests/contract/host-api.contract.test.ts
git commit -m "feat: HostApi schemaEditSupported/schemaOps/applyDdl routing"
```

---

### Task 6: Store — `'structure'` tab kind + openStructure + applyDdl

**Files:**

- Modify: `src/renderer/src/store-query.ts`

**Interfaces:**

- Consumes: `hostApi()`, `invalidateIntrospection`, `queryClient`.
- Produces: `QueryTab.kind` gains `'structure'`; `QueryTab.structure?: { schema; table }`; `openStructure(schema, table)`; `applyDdl(statements)`.

- [ ] **Step 1: Extend the tab shape + actions**

Modify `src/renderer/src/store-query.ts`:

- `QueryTab.kind` becomes `'query' | 'data' | 'structure'`.
- Add `structure?: { schema: string; table: string }` to `QueryTab`.
- Add to `QueryState`:

```ts
  openStructure: (schema: string, table: string) => void
  applyDdl: (statements: string[]) => Promise<void>
```

- Implement:

```ts
  openStructure: (schema, table) => {
    const id = tabId()
    const tab: QueryTab = {
      id,
      sql: `structure ${schema}.${table}`,
      status: 'done',
      kind: 'structure',
      structure: { schema, table }
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
  },
  applyDdl: async (statements) => {
    const connId = useConnStore.getState().activeConnectionId
    if (!connId) return
    await (await hostApi()).applyDdl(connId, statements)
    // Structure change → schema tree + any structure view re-fetch.
    void invalidateIntrospection(queryClient, connId)
  },
```

(Note: the `applyEdits` action already exists and is named `applyEdits`; `applyDdl` is a new, separate action. Do not conflate them.)

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

```bash
git add src/renderer/src/store-query.ts
git commit -m "feat: structure tab kind + openStructure + applyDdl store actions"
```

---

### Task 7: StructureView component

**Files:**

- Create: `src/renderer/src/components/StructureView.tsx`
- Modify: `src/renderer/src/components/QueryWorkbench.tsx` (render it for `kind === 'structure'`)

**Interfaces:**

- Consumes: `openStructure`/`applyDdl` (Task 6), `buildDdl`/`reconstructDdl` (Task 2), the introspection hooks (`useColumns`/`useKeys`/`useIndexes` or their existing equivalents in `query/introspection.ts` — check the exact exported names and reuse them), `schemaOps` via `hostApi()`, the active connection's engine (from `useConnStore`) to pick the dialect.

**Acceptance (implement with the existing UI primitives; keep this behavior):**

- **Three panels** — Columns (name, type, nullable, default, ordinal), Indexes, Foreign keys — from the introspection hooks. A **reconstructed-DDL** block from `reconstructDdl`.
- **Dialect** = `'pg'` when the active connection's engine is `postgres`, else `'sqlite'`.
- **Ops gating:** fetch `schemaOps(connId)` once; show `[+ column]`, `[+ index]`, `[+ FK]`, per-index/FK `[drop]`, and header `[drop table]` **only** when the corresponding op is true.
- **Every action** builds a `DdlChange`, runs `buildDdl(change, dialect)`, shows the generated SQL in a confirm dialog (`window.confirm` with the joined statements, matching the row-edit preview convention), and on confirm calls `applyDdl(statements)`. Errors surface in an inline banner.
- Forms are minimal inline/popover controls (native `<select>`/`<input>`), not a modal framework. Give the add-column type input and the op-relevant controls stable `aria-label`s (e.g. `ddl-column-name`, `ddl-column-type`, `ddl-index-name`) so the e2e can target them.

- [ ] **Step 1: Implement StructureView + wire into the workbench**

Build per the acceptance. Read `schema`/`table` from `tab.structure`. Reuse the introspection hooks (do not add new RPC methods). Wire `QueryWorkbench` to render `<StructureView tab={tab} />` when `tab.kind === 'structure'` (mirroring how it branches to `TableDataGrid` for `'data'`).

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Report which introspection hook names and UI primitives you used.

```bash
git add src/renderer/src/components/StructureView.tsx src/renderer/src/components/QueryWorkbench.tsx
git commit -m "feat: StructureView — panels, reconstructed DDL, previewed additive DDL"
```

---

### Task 8: Schema-tree entries — Structure, create-table, create/drop schema & database

**Files:**

- Modify: `src/renderer/src/components/SchemaTree.tsx`

**Interfaces:**

- Consumes: `openStructure`/`applyDdl` (Task 6), `buildDdl` (Task 2), `schemaOps`, the tree's existing context-menu machinery.

**Acceptance:**

- **Table context menu** gains **"Structure"** → `openStructure(schema, table)` (alongside the existing Open data / Show columns / Table info / Copy name items).
- **Schema node context menu** (PG, gated on `schemaOps`): **"New table…"** (name + a minimal one-column form is acceptable; it opens the create-table preview via `buildDdl({kind:'createTable', …})` → confirm → `applyDdl`), **"Drop schema"** (previewed).
- **Database / connection-root context menu** (PG, gated): **"New database…"**, **"Drop database"** — each previewed via `buildDdl` → confirm → `applyDdl`. `CREATE/DROP DATABASE` is routed through `applyDdl` as a single statement (the PG editor runs it outside a txn).
- All destructive items show the generated SQL and require confirm. SQLite shows only "Structure" + "New table…" (its `schemaOps` disables schema/database ops).

- [ ] **Step 1: Add the context-menu items**

Implement per acceptance, gating each write item on the fetched `schemaOps`. Reuse the existing context-menu component/pattern in `SchemaTree.tsx`.

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

```bash
git add src/renderer/src/components/SchemaTree.tsx
git commit -m "feat: schema-tree Structure + create-table/schema/database entries (gated)"
```

---

### Task 9: Structure e2e (headless SQLite)

**Files:**

- Create: `tests/e2e/structure.spec.ts`

**Interfaces:**

- Consumes: the running app + a temp SQLite file with a table.

- [ ] **Step 1: e2e**

`tests/e2e/structure.spec.ts` — connect SQLite, open a table's Structure tab, add a column (previewed via an auto-accepted dialog), and assert the columns panel/tree reflects it. Use a fresh `--user-data-dir`. Auto-accept the confirm dialog:

```ts
import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('view structure and add a column (previewed)', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-struct-')), 's.sqlite')
  const db = createClient({ url: `file:${file}` })
  await db.executeMultiple(`CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT);`)
  db.close()
  const userData = mkdtempSync(join(tmpdir(), 'fordb-ud-'))

  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()
  win.on('dialog', (d) => void d.accept()) // auto-confirm the DDL preview

  await win.getByText('+ New connection').click()
  await win.getByRole('combobox', { name: 'Database engine' }).click()
  await win.getByRole('option', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('struct-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Save').click()
  await win.getByText('struct-sqlite').click()

  await win.getByText('main', { exact: true }).click()
  await win.getByText('widgets').click({ button: 'right' })
  await win.getByText('Structure', { exact: true }).click()

  // Columns panel shows the existing columns.
  await expect(win.getByText('label')).toBeVisible({ timeout: 15000 })

  // Add a column.
  await win.getByText('+ column', { exact: false }).click()
  await win.getByLabel('ddl-column-name').fill('qty')
  await win.getByLabel('ddl-column-type').fill('integer')
  await win.getByText('Add', { exact: true }).click()

  await expect(win.getByText('qty')).toBeVisible({ timeout: 15000 })
  await app.close()
})
```

Adjust the selectors (`+ column`, `ddl-column-name`, `ddl-column-type`, `Add`) to exactly what Task 7 renders. Because the confirm is a native dialog, the `win.on('dialog')` handler auto-accepts the preview.

- [ ] **Step 2: Run + commit**

Run: `pnpm build && pnpm e2e tests/e2e/structure.spec.ts`.

```bash
git add tests/e2e/structure.spec.ts
git commit -m "test: structure/add-column e2e (headless SQLite)"
```

---

## Self-Review (done at plan time)

1. **Spec coverage:** Structure view + reconstructed DDL → Tasks 2 (pure) + 7 (UI). Each DDL op (create table, add column, index add/drop, FK add/drop, drop table, schema/db create/drop) → `buildDdl` (2), engine apply (3, 4), HostApi (5), UI entry (7, 8). Engine gating via `SchemaOps` → advertised in 3/4, enforced in UI 7/8, defended in 5. Preview+confirm → 7/8. Contract per op → 3 (PG all) + 4 (SQLite subset) + 5 (host round-trip). e2e → 9.
2. **Placeholder scan:** Full code in Tasks 1–6, 9. Tasks 7–8 are acceptance-defined (the exact form/menu widgets follow existing renderer primitives) with every consumed contract (`buildDdl`, `applyDdl`, `schemaOps`, introspection hooks) fully specified — deliberate, mirroring the MA2 grid task.
3. **Type consistency:** `SchemaOps`/`ColumnSpec`/`TableSpec`/`IndexSpec`/`ForeignKeySpec`/`DdlChange`/`SchemaEditor` (Task 1) used verbatim in 2–8. `buildDdl(change, dialect): string[]` (2) consumed by 7/8. `applyDdl(statements)` name is consistent host→store→UI; distinct from the existing `applyEdits`. `reconstructDdl(cols, keys, indexes, schema, table, dialect)` (2) consumed by 7.

**Known deliberate deferrals (MA3b):** in-place column ALTER (rename/type/default/nullable), DROP COLUMN, SQLite table-rebuild machinery, and FK/schema/database ops on SQLite.

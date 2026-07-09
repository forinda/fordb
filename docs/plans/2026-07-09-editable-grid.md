# fordb MA1 Editable Data Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a table's data in an editable grid — inline cell edit, insert row, delete row — accumulated as a pending change set, previewed as SQL, applied to Postgres or SQLite in one transaction with bound values.

**Architecture:** A `DataMutator` adapter capability (`apply(edits)` only — transactional, bound params). Preview SQL is a **pure shared function** (`previewEdits`), so the renderer shows it with no round-trip. A workbench **data tab** (`kind:'data'`) opens a table via `SELECT *` + PK and renders an editable Glide grid; a review dialog shows `previewEdits(...)` then calls `applyEdits`.

**Tech Stack:** TypeScript strict, `pg`, `@libsql/client`, `@glideapps/glide-data-grid`, React 19, Zustand, vitest, Playwright.

## Global Constraints

- pnpm; Node >= 22; TypeScript strict; no `any` except typed casts at the RPC/DB boundary.
- **Values are BOUND** (`$n` for PG, `?` for SQLite) at apply — NEVER interpolated. Identifiers are quoted with `"…"` and embedded `"` doubled. `preview` produces DISPLAY-only SQL (literals inlined) and is never executed.
- Every `apply` is ONE transaction (PG `BEGIN/COMMIT/ROLLBACK`; SQLite `client.batch(stmts,'write')`) — any failure rolls the whole set back.
- Editing is capability-gated (`adapter.dataMutator`): PG + SQLite now; engines without it are read-only.
- Only the single-table **data view** is editable; the free-form query grid stays read-only. PK/unique required — else read-only + note. Explicit NULL (NULL ≠ '').
- Secrets never reach the renderer; all writes go through the connectionId-routed HostApi.
- `@shared/*` alias. Renderer-importing tests → `tsconfig.web` (excluded from `tsconfig.node`); pure/db-host tests → `tsconfig.node`.
- Each task ends with `pnpm typecheck && pnpm lint && pnpm test` green (+ `pnpm build` for renderer tasks). Contract tasks run `pnpm db:up && pnpm test:contract && pnpm db:down`.
- One PR per task against `main`.

## Deviation from the spec (noted)

The spec put `preview` on the `DataMutator` capability and `previewEdits` on `HostApi`. Preview is pure text generation from `RowEdit[]` — it needs no database — so this plan makes it a **shared pure function** the renderer calls directly (no RPC), and `DataMutator` is `apply`-only. The security property is unchanged: the displayed SQL (literals) is never the executed SQL (bound). HostApi adds only `mutationSupported` + `applyEdits`.

## File Structure (end state)

```
src/shared/adapter/mutation-types.ts         # NEW: Cell, RowEdit, DataMutator
src/shared/adapter/db-adapter.ts             # MODIFY: readonly dataMutator?
src/shared/mutation/build-edits.ts           # NEW: quoteIdent, renderLiteral, previewEdit/previewEdits, buildEdits
src/db-host/postgres/postgres-mutator.ts     # NEW: PgDataMutator (apply)
src/db-host/postgres/postgres-adapter.ts     # MODIFY: readonly dataMutator
src/db-host/sqlite/sqlite-mutator.ts         # NEW: SqliteDataMutator (apply)
src/db-host/sqlite/sqlite-adapter.ts         # MODIFY: readonly dataMutator
src/shared/host/host-api.ts                  # MODIFY: mutationSupported/applyEdits
src/db-host/host-api-impl.ts                 # MODIFY: route them
src/renderer/src/store-query.ts              # MODIFY: tab kind 'data' + openTable + applyEdits action
src/renderer/src/components/TableDataGrid.tsx    # NEW: editable grid + toolbar + review dialog
src/renderer/src/components/QueryWorkbench.tsx    # MODIFY: render data tabs
src/renderer/src/components/SchemaTree.tsx   # MODIFY: table activation → openTable
tests/contract/adapter-contract.ts           # MODIFY: capability-gated mutator block
tests/unit/build-edits.test.ts               # NEW
tests/e2e/edit.spec.ts                       # NEW
```

---

### Task 1: Mutation types + capability member

**Files:**

- Create: `src/shared/adapter/mutation-types.ts`
- Modify: `src/shared/adapter/db-adapter.ts`

**Interfaces:**

- Produces: `Cell`, `RowEdit`, `DataMutator`; `DbAdapter.dataMutator?: DataMutator`.

- [ ] **Step 1: Types**

`src/shared/adapter/mutation-types.ts`:

```ts
/** A column/value pair. `value` is string | number | boolean | null. */
export interface Cell {
  column: string
  value: unknown
}

export type RowEdit =
  | { kind: 'update'; schema: string; table: string; pk: Cell[]; set: Cell[] }
  | { kind: 'insert'; schema: string; table: string; values: Cell[] }
  | { kind: 'delete'; schema: string; table: string; pk: Cell[] }

/** Optional write capability. Engines that can't mutate omit it. `apply` runs
 *  all edits in ONE transaction with BOUND values, rolling back on any error.
 *  Preview SQL is generated purely on the renderer (see @shared/mutation/build-edits). */
export interface DataMutator {
  apply(edits: RowEdit[]): Promise<void>
}
```

- [ ] **Step 2: Capability member**

Modify `src/shared/adapter/db-adapter.ts` — add import `import type { DataMutator } from './mutation-types'` and, after `serverStats?`:

```ts
  /** Optional data-write capability (Postgres + SQLite). */
  readonly dataMutator?: DataMutator
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test` (green; types only).

```bash
git add src/shared/adapter/mutation-types.ts src/shared/adapter/db-adapter.ts
git commit -m "feat: DataMutator types + optional adapter capability"
```

---

### Task 2: Pure edit-builder + preview (`build-edits.ts`)

**Files:**

- Create: `src/shared/mutation/build-edits.ts`, `tests/unit/build-edits.test.ts`

**Interfaces:**

- Consumes: `RowEdit`, `Cell` (Task 1).
- Produces: `quoteIdent(id): string`, `renderLiteral(v): string`, `previewEdit(e): string`, `previewEdits(edits): string[]`, `buildEdits(input): RowEdit[]`.

- [ ] **Step 1: Failing tests**

`tests/unit/build-edits.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  quoteIdent,
  renderLiteral,
  previewEdit,
  buildEdits
} from '../../src/shared/mutation/build-edits'
import type { RowEdit } from '../../src/shared/adapter/mutation-types'

describe('quoteIdent', () => {
  it('quotes and doubles embedded quotes', () => {
    expect(quoteIdent('users')).toBe('"users"')
    expect(quoteIdent('we"ird')).toBe('"we""ird"')
  })
})

describe('renderLiteral', () => {
  it('renders NULL, numbers, booleans, escaped strings', () => {
    expect(renderLiteral(null)).toBe('NULL')
    expect(renderLiteral(undefined)).toBe('NULL')
    expect(renderLiteral(42)).toBe('42')
    expect(renderLiteral(true)).toBe('true')
    expect(renderLiteral("O'Brien")).toBe("'O''Brien'")
  })
})

describe('previewEdit', () => {
  it('renders an UPDATE with SET + WHERE', () => {
    const e: RowEdit = {
      kind: 'update',
      schema: 'app',
      table: 'users',
      pk: [{ column: 'id', value: 1 }],
      set: [
        { column: 'name', value: 'Bob' },
        { column: 'email', value: null }
      ]
    }
    expect(previewEdit(e)).toBe(
      `UPDATE "app"."users" SET "name" = 'Bob', "email" = NULL WHERE "id" = 1`
    )
  })
  it('renders an INSERT', () => {
    const e: RowEdit = {
      kind: 'insert',
      schema: 'app',
      table: 'users',
      values: [
        { column: 'email', value: 'a@x' },
        { column: 'name', value: 'A' }
      ]
    }
    expect(previewEdit(e)).toBe(`INSERT INTO "app"."users" ("email", "name") VALUES ('a@x', 'A')`)
  })
  it('renders a DELETE', () => {
    const e: RowEdit = {
      kind: 'delete',
      schema: 'app',
      table: 'users',
      pk: [{ column: 'id', value: 2 }]
    }
    expect(previewEdit(e)).toBe(`DELETE FROM "app"."users" WHERE "id" = 2`)
  })
})

describe('buildEdits', () => {
  it('assembles updates/inserts/deletes with schema+table', () => {
    const out = buildEdits({
      schema: 'app',
      table: 'users',
      updates: [{ pk: [{ column: 'id', value: 1 }], set: [{ column: 'name', value: 'X' }] }],
      inserts: [{ values: [{ column: 'name', value: 'N' }] }],
      deletes: [{ pk: [{ column: 'id', value: 3 }] }]
    })
    expect(out).toEqual([
      {
        kind: 'update',
        schema: 'app',
        table: 'users',
        pk: [{ column: 'id', value: 1 }],
        set: [{ column: 'name', value: 'X' }]
      },
      { kind: 'insert', schema: 'app', table: 'users', values: [{ column: 'name', value: 'N' }] },
      { kind: 'delete', schema: 'app', table: 'users', pk: [{ column: 'id', value: 3 }] }
    ])
  })
})
```

- [ ] **Step 2: Run → FAIL** — `pnpm vitest run tests/unit/build-edits.test.ts` (module missing).

- [ ] **Step 3: Implement**

`src/shared/mutation/build-edits.ts`:

```ts
import type { Cell, RowEdit } from '../adapter/mutation-types'

/** Quote a SQL identifier, doubling embedded double-quotes. */
export function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`
}

/** Render a value as a SQL literal FOR DISPLAY ONLY (never executed). */
export function renderLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return `'${String(v).replace(/'/g, "''")}'`
}

const qualified = (schema: string, table: string): string =>
  `${quoteIdent(schema)}.${quoteIdent(table)}`
const eq = (c: Cell): string => `${quoteIdent(c.column)} = ${renderLiteral(c.value)}`

/** Display SQL for one edit (bound values shown as literals). */
export function previewEdit(e: RowEdit): string {
  const t = qualified(e.schema, e.table)
  if (e.kind === 'update')
    return `UPDATE ${t} SET ${e.set.map(eq).join(', ')} WHERE ${e.pk.map(eq).join(' AND ')}`
  if (e.kind === 'insert')
    return `INSERT INTO ${t} (${e.values.map((c) => quoteIdent(c.column)).join(', ')}) VALUES (${e.values
      .map((c) => renderLiteral(c.value))
      .join(', ')})`
  return `DELETE FROM ${t} WHERE ${e.pk.map(eq).join(' AND ')}`
}

export function previewEdits(edits: RowEdit[]): string[] {
  return edits.map(previewEdit)
}

export interface PendingEdits {
  schema: string
  table: string
  updates: { pk: Cell[]; set: Cell[] }[]
  inserts: { values: Cell[] }[]
  deletes: { pk: Cell[] }[]
}

/** Flatten the grid's pending change set into an ordered RowEdit list. */
export function buildEdits(p: PendingEdits): RowEdit[] {
  const { schema, table } = p
  return [
    ...p.updates.map((u): RowEdit => ({ kind: 'update', schema, table, pk: u.pk, set: u.set })),
    ...p.inserts.map((i): RowEdit => ({ kind: 'insert', schema, table, values: i.values })),
    ...p.deletes.map((d): RowEdit => ({ kind: 'delete', schema, table, pk: d.pk }))
  ]
}
```

- [ ] **Step 4: Run → PASS + commit**

Run: `pnpm vitest run tests/unit/build-edits.test.ts` (green), then `pnpm typecheck && pnpm lint`.

```bash
git add src/shared/mutation/build-edits.ts tests/unit/build-edits.test.ts
git commit -m "feat: pure edit-builder + preview SQL (quote/escape)"
```

---

### Task 3: PgDataMutator + contract test

**Files:**

- Create: `src/db-host/postgres/postgres-mutator.ts`
- Modify: `src/db-host/postgres/postgres-adapter.ts`, `tests/contract/adapter-contract.ts`

**Interfaces:**

- Consumes: `DataMutator`, `RowEdit`, `quoteIdent` (Task 2), `pg.Client`.
- Produces: `class PgDataMutator implements DataMutator`; `PostgresAdapter.dataMutator`.

- [ ] **Step 1: PgDataMutator**

`src/db-host/postgres/postgres-mutator.ts`:

```ts
import type pg from 'pg'
import type { DataMutator, RowEdit } from '@shared/adapter/mutation-types'
import { quoteIdent } from '@shared/mutation/build-edits'

/** Builds a parameterized statement ($1…) + ordered params for one edit. */
function statement(e: RowEdit): { text: string; params: unknown[] } {
  const t = `${quoteIdent(e.schema)}.${quoteIdent(e.table)}`
  const params: unknown[] = []
  const bind = (v: unknown): string => `$${params.push(v)}`
  if (e.kind === 'update') {
    const set = e.set.map((c) => `${quoteIdent(c.column)} = ${bind(c.value)}`).join(', ')
    const where = e.pk.map((c) => `${quoteIdent(c.column)} = ${bind(c.value)}`).join(' AND ')
    return { text: `UPDATE ${t} SET ${set} WHERE ${where}`, params }
  }
  if (e.kind === 'insert') {
    const cols = e.values.map((c) => quoteIdent(c.column)).join(', ')
    const vals = e.values.map((c) => bind(c.value)).join(', ')
    return { text: `INSERT INTO ${t} (${cols}) VALUES (${vals})`, params }
  }
  const where = e.pk.map((c) => `${quoteIdent(c.column)} = ${bind(c.value)}`).join(' AND ')
  return { text: `DELETE FROM ${t} WHERE ${where}`, params }
}

export class PgDataMutator implements DataMutator {
  constructor(private readonly conn: () => pg.Client) {}

  async apply(edits: RowEdit[]): Promise<void> {
    const c = this.conn()
    await c.query('BEGIN')
    try {
      for (const e of edits) {
        const { text, params } = statement(e)
        await c.query(text, params)
      }
      await c.query('COMMIT')
    } catch (err) {
      await c.query('ROLLBACK')
      throw err
    }
  }
}
```

- [ ] **Step 2: Wire onto PostgresAdapter**

Modify `src/db-host/postgres/postgres-adapter.ts`: import `PgDataMutator` and `DataMutator`, add a field next to `serverStats`:

```ts
  readonly dataMutator: DataMutator = new PgDataMutator(() => this.conn)
```

- [ ] **Step 3: Capability-gated contract test**

Modify `tests/contract/adapter-contract.ts` — append inside the `describe`, AFTER the server-stats tests (so mutations run last and don't disturb earlier read assertions):

```ts
it('data mutator: update/insert/delete apply, and a bad batch rolls back', async () => {
  if (!adapter.dataMutator) return
  const s = expected.schema
  // update
  await adapter.dataMutator.apply([
    {
      kind: 'update',
      schema: s,
      table: 'users',
      pk: [{ column: 'id', value: 1 }],
      set: [{ column: 'name', value: 'Zed' }]
    }
  ])
  const afterUpdate = await adapter.executeQuery(`SELECT name FROM ${s}.users WHERE id = 1`)
  expect(afterUpdate.rows[0]?.[0]).toBe('Zed')

  // insert
  await adapter.dataMutator.apply([
    {
      kind: 'insert',
      schema: s,
      table: 'users',
      values: [
        { column: 'email', value: 'zzz@example.com' },
        { column: 'name', value: 'Zzz' }
      ]
    }
  ])
  const inserted = await adapter.executeQuery(
    `SELECT name FROM ${s}.users WHERE email = 'zzz@example.com'`
  )
  expect(inserted.rows[0]?.[0]).toBe('Zzz')

  // delete
  const idRes = await adapter.executeQuery(
    `SELECT id FROM ${s}.users WHERE email = 'zzz@example.com'`
  )
  const zid = idRes.rows[0]?.[0]
  await adapter.dataMutator.apply([
    { kind: 'delete', schema: s, table: 'users', pk: [{ column: 'id', value: zid }] }
  ])
  const gone = await adapter.executeQuery(
    `SELECT count(*) FROM ${s}.users WHERE email = 'zzz@example.com'`
  )
  expect(Number(gone.rows[0]?.[0])).toBe(0)

  // rollback: a valid update followed by a UNIQUE-violating insert must
  // leave the update un-applied.
  await expect(
    adapter.dataMutator.apply([
      {
        kind: 'update',
        schema: s,
        table: 'users',
        pk: [{ column: 'id', value: 1 }],
        set: [{ column: 'name', value: 'RolledBack' }]
      },
      {
        kind: 'insert',
        schema: s,
        table: 'users',
        values: [
          { column: 'email', value: 'user2@example.com' },
          { column: 'name', value: 'Dup' }
        ]
      }
    ])
  ).rejects.toThrow()
  const rolled = await adapter.executeQuery(`SELECT name FROM ${s}.users WHERE id = 1`)
  expect(rolled.rows[0]?.[0]).not.toBe('RolledBack')
})
```

Note: `user2@example.com` exists in the fixture (users 1..1000), so the second insert violates the UNIQUE(email) constraint → the batch rolls back.

- [ ] **Step 4: Run + commit**

Run: `pnpm db:up && pnpm test:contract && pnpm db:down` (the new test runs for PG; SQLite adapter has no `dataMutator` yet → its gated test returns early). `pnpm typecheck && pnpm lint && pnpm test`.

```bash
git add src/db-host/postgres/postgres-mutator.ts src/db-host/postgres/postgres-adapter.ts tests/contract/adapter-contract.ts
git commit -m "feat: PgDataMutator (transactional, bound) + contract test"
```

---

### Task 4: SqliteDataMutator + contract coverage

**Files:**

- Create: `src/db-host/sqlite/sqlite-mutator.ts`
- Modify: `src/db-host/sqlite/sqlite-adapter.ts`

**Interfaces:**

- Consumes: `DataMutator`, `RowEdit`, `quoteIdent`, `@libsql/client` `Client`.
- Produces: `class SqliteDataMutator implements DataMutator`; `SqliteAdapter.dataMutator`.

- [ ] **Step 1: SqliteDataMutator**

`src/db-host/sqlite/sqlite-mutator.ts`:

```ts
import type { Client, InStatement } from '@libsql/client'
import type { DataMutator, RowEdit } from '@shared/adapter/mutation-types'
import { quoteIdent } from '@shared/mutation/build-edits'

function statement(e: RowEdit): InStatement {
  const t = `${quoteIdent(e.schema)}.${quoteIdent(e.table)}`
  const args: unknown[] = []
  const bind = (v: unknown): string => {
    args.push(v)
    return '?'
  }
  if (e.kind === 'update') {
    const set = e.set.map((c) => `${quoteIdent(c.column)} = ${bind(c.value)}`).join(', ')
    const where = e.pk.map((c) => `${quoteIdent(c.column)} = ${bind(c.value)}`).join(' AND ')
    return { sql: `UPDATE ${t} SET ${set} WHERE ${where}`, args: args as never }
  }
  if (e.kind === 'insert') {
    const cols = e.values.map((c) => quoteIdent(c.column)).join(', ')
    const vals = e.values.map((c) => bind(c.value)).join(', ')
    return { sql: `INSERT INTO ${t} (${cols}) VALUES (${vals})`, args: args as never }
  }
  const where = e.pk.map((c) => `${quoteIdent(c.column)} = ${bind(c.value)}`).join(' AND ')
  return { sql: `DELETE FROM ${t} WHERE ${where}`, args: args as never }
}

export class SqliteDataMutator implements DataMutator {
  constructor(private readonly conn: () => Client) {}

  async apply(edits: RowEdit[]): Promise<void> {
    // libsql batch(..., 'write') runs the statements in a single transaction and
    // rolls back on any failure.
    await this.conn().batch(edits.map(statement), 'write')
  }
}
```

- [ ] **Step 2: Wire onto SqliteAdapter**

Modify `src/db-host/sqlite/sqlite-adapter.ts`: import `SqliteDataMutator` and `DataMutator`, add a field:

```ts
  readonly dataMutator: DataMutator = new SqliteDataMutator(() => this.conn)
```

- [ ] **Step 3: Run the contract for SQLite (reuses Task 3's gated test)**

The mutator test added in Task 3 is capability-gated and schema-parameterized (`expected.schema`), so it now runs for the local SQLite contract (`schema='main'`) and the remote/replica ones too. Run:

```bash
pnpm vitest run -c vitest.contract.config.ts tests/contract/sqlite.contract.test.ts
```

Expected: the mutator test passes for SQLite (update/insert/delete + rollback via `batch('write')`). Then full: `pnpm db:up && pnpm test:contract && pnpm db:down`.

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`.

```bash
git add src/db-host/sqlite/sqlite-mutator.ts src/db-host/sqlite/sqlite-adapter.ts
git commit -m "feat: SqliteDataMutator (libsql batch write) + contract coverage"
```

---

### Task 5: HostApi surface + routing

**Files:**

- Modify: `src/shared/host/host-api.ts`, `src/db-host/host-api-impl.ts`

**Interfaces:**

- Produces: `HostApi.mutationSupported(id)`, `HostApi.applyEdits(id, edits)`.

- [ ] **Step 1: Interface**

Modify `src/shared/host/host-api.ts`: import `import type { RowEdit } from '../adapter/mutation-types'`, add after the stats methods:

```ts
  mutationSupported(id: ConnectionId): Promise<boolean>
  applyEdits(id: ConnectionId, edits: RowEdit[]): Promise<void>
```

- [ ] **Step 2: Routing**

Modify `src/db-host/host-api-impl.ts`: import `RowEdit` + `DataMutator`, add a helper + methods:

```ts
  private mutator(id: ConnectionId): DataMutator {
    const m = this.registry.get(id).dataMutator
    if (!m) throw new Error('Editing is not supported by this engine')
    return m
  }
  async mutationSupported(id: ConnectionId): Promise<boolean> {
    return this.registry.get(id).dataMutator != null
  }
  applyEdits(id: ConnectionId, edits: RowEdit[]): Promise<void> {
    return this.mutator(id).apply(edits)
  }
```

- [ ] **Step 3: host-api contract assertion**

Modify `tests/contract/host-api.contract.test.ts` — add (opening its own connection like the existing tests):

```ts
it('exposes data mutation over the HostApi', async () => {
  const id = await client.openConnection(profile)
  expect(await client.mutationSupported(id)).toBe(true)
  await client.applyEdits(id, [
    {
      kind: 'update',
      schema: 'app',
      table: 'users',
      pk: [{ column: 'id', value: 3 }],
      set: [{ column: 'name', value: 'Via HostApi' }]
    }
  ])
  const r = await client.executeQuery(id, `SELECT name FROM app.users WHERE id = 3`)
  expect(r.rows[0]?.[0]).toBe('Via HostApi')
  await client.closeConnection(id)
})
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm db:up && pnpm test:contract && pnpm db:down`.

```bash
git add src/shared/host/host-api.ts src/db-host/host-api-impl.ts tests/contract/host-api.contract.test.ts
git commit -m "feat: HostApi mutationSupported + applyEdits routing"
```

---

### Task 6: Data tab in the store (kind + openTable + apply)

**Files:**

- Modify: `src/renderer/src/store-query.ts`

**Interfaces:**

- Consumes: `hostApi()`, `useConnStore`, `RowEdit`, `QueryResultSource`, `getKeys`.
- Produces: `QueryTab.kind`, `QueryTab.data`, `openTable(schema, table)`, `applyEdits(tabId, edits)`.

- [ ] **Step 1: Extend the tab shape + actions**

Modify `src/renderer/src/store-query.ts`:

- `QueryTab` gains: `kind: 'query' | 'data'` and an optional `data?: { schema: string; table: string; pkColumns: string[]; connId: string }`. Existing tabs are `kind: 'query'` (set it in `newTab`).
- Add to `QueryState`: `openTable: (schema: string, table: string) => Promise<void>` and `applyEdits: (tabId: string, edits: RowEdit[]) => Promise<void>`.
- `openTable` implementation:

```ts
  openTable: async (schema, table) => {
    const connId = useConnStore.getState().activeConnectionId
    if (!connId) return
    const api = await hostApi()
    const keys = await api.getKeys(connId, schema, table)
    const pk = keys.find((k) => k.kind === 'primary') ?? keys.find((k) => k.kind === 'unique')
    const id = tabId()
    const tab: QueryTab = {
      id,
      sql: `SELECT * FROM "${schema}"."${table}"`,
      status: 'idle',
      kind: 'data',
      data: { schema, table, pkColumns: pk?.columns ?? [], connId }
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
    await get().run(id) // reuse the SELECT streaming path
  },
  applyEdits: async (tabId, edits) => {
    const connId = useConnStore.getState().activeConnectionId
    if (!connId) return
    await (await hostApi()).applyEdits(connId, edits)
    await get().run(tabId) // refresh the data view
  },
```

(`run(id)` already streams `tab.sql` via `openQuery` → `QueryResultSource`; a data tab's `sql` is the `SELECT *`, so it just works. `run` must not treat a data tab specially — it doesn't.)

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

```bash
git add src/renderer/src/store-query.ts
git commit -m "feat: data-tab kind + openTable + applyEdits in the query store"
```

---

### Task 7: TableDataGrid (editable grid + review dialog)

**Files:**

- Create: `src/renderer/src/components/TableDataGrid.tsx`

**Interfaces:**

- Consumes: `QueryResultSource`, the data tab (`{schema, table, pkColumns}`), `buildEdits`/`previewEdits` (Task 2), `useQueryStore.applyEdits` (Task 6), Glide `DataEditor`.
- Produces: `<TableDataGrid tab={dataTab} />`.

**Acceptance (Glide specifics may vary by version — implement whichever the installed `@glideapps/glide-data-grid` supports cleanly, keeping this behavior):**

- Editable grid over `tab.source` (like `ResultsGrid` but `allowOverlay: true` + `onCellEdited`).
- `tab.data.pkColumns.length === 0` → read-only, render `<div>No primary key — read only</div>` above the grid, no toolbar.
- Otherwise a toolbar: dirty count, **Review & apply**, **Discard**; plus **+ Row** (append a pending insert) and a delete affordance for the selected row; a "set NULL" affordance on a focused cell (NULL renders as a dim `∅`).
- Pending state (component-local): `editedCells` (row index → column → new value), `insertedRows` (array of column→value), `deletedRows` (set of row indices). Dirty cells styled distinctly.
- **Review & apply**: convert the pending state to a `PendingEdits` (pk cells read from the ORIGINAL row via `source.getRow`, using `tab.data.pkColumns`; `set` = changed cells for that row), then `const edits = buildEdits(pending)`, show `previewEdits(edits)` joined by `;\n` in a confirm dialog (a simple modal or `window.confirm` fallback is acceptable for v1), and on confirm call `useQueryStore.getState().applyEdits(tab.id, edits)` then clear pending. On error, surface the message and keep pending.

- [ ] **Step 1: Implement TableDataGrid**

Build the component per the acceptance above. Reuse `ResultsGrid`'s `getCellContent`/`onVisibleRegionChanged` paging shape; add `onCellEdited={(cell, newVal) => …}` recording into `editedCells`; map `pkColumns` + `source.fields` to build `Cell[]` for pk/set. Column names come from `source.fields.map(f => f.name)`.

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Report exactly which Glide edit APIs you used.

```bash
git add src/renderer/src/components/TableDataGrid.tsx
git commit -m "feat: editable TableDataGrid with SQL preview + apply"
```

---

### Task 8: Wire the data tab into the workbench + tree

**Files:**

- Modify: `src/renderer/src/components/QueryWorkbench.tsx`, `src/renderer/src/components/SchemaTree.tsx`

**Interfaces:**

- Consumes: `TableDataGrid` (Task 7), `openTable` (Task 6).

- [ ] **Step 1: Render data tabs**

Modify `src/renderer/src/components/QueryWorkbench.tsx` — the active tab render currently assumes a query tab (SQL editor + results). Branch on `tab.kind`: for `'data'` render `<TableDataGrid tab={tab} />` (full height, no SQL editor); for `'query'` the existing editor+results layout. Keep the shared toolbar/tab-bar.

- [ ] **Step 2: Open a table from the tree**

Modify `src/renderer/src/components/SchemaTree.tsx` — a table/view node activation opens its data. Add to the row: on double-click (and Enter via react-arborist's activation) for a `table`/`view` node, call `useQueryStore.getState().openTable(node.schema, node.name)`. Keep the existing single-click expand/collapse (tables have no children to expand except columns, so double-click-to-open is unambiguous). Also add a palette command `open-table` is out of scope (needs a selected node) — double-click/Enter is enough for v1.

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Headless dev smoke optional.

```bash
git add src/renderer/src/components/QueryWorkbench.tsx src/renderer/src/components/SchemaTree.tsx
git commit -m "feat: open table data tabs from the schema tree"
```

---

### Task 9: Edit e2e (headless SQLite)

**Files:**

- Create: `tests/e2e/edit.spec.ts`

**Interfaces:**

- Consumes: the running app + a temp SQLite file.

- [ ] **Step 1: e2e**

`tests/e2e/edit.spec.ts` — SQLite (no keychain, headless). Build a temp file with a PK table, connect, open the table, edit a cell, apply, assert persisted:

```ts
import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('edit a cell in the data grid and apply', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-edit-')), 'edit.sqlite')
  const db = createClient({ url: `file:${file}` })
  await db.executeMultiple(
    `CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO widgets (label) VALUES ('before');`
  )
  db.close()

  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByRole('combobox', { name: 'Database engine' }).click()
  await win.getByRole('option', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('edit-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Save').click()
  await win.getByText('edit-sqlite').click()

  await win.getByText('main', { exact: true }).click()
  await win.getByText('widgets').dblclick() // open data tab
  await expect(win.getByText('before')).toBeVisible({ timeout: 15000 })

  // Edit the label cell → 'after'. Glide grid: double-click the cell, type, Enter.
  // (Adjust the interaction to the actual grid overlay if needed.)
  await win.getByText('before').dblclick()
  await win.keyboard.press('Control+A')
  await win.keyboard.type('after')
  await win.keyboard.press('Enter')

  await win.getByText('Review & apply').click()
  // Confirm dialog (modal button or the native confirm auto-accept via a handler).
  await win.getByText(/Apply|Confirm/).click()

  await expect(win.getByText('after')).toBeVisible({ timeout: 15000 })
  // Verify persisted independently.
  const check = createClient({ url: `file:${file}` })
  const r = await check.execute('SELECT label FROM widgets WHERE id = 1')
  check.close()
  expect(r.rows[0]?.label).toBe('after')

  await app.close()
})
```

Note: the exact grid-edit keystrokes and the confirm-dialog selector depend on Task 7's implementation — adjust the interaction to what `TableDataGrid` renders (this is the same acceptance-defined UI wiring as Task 7). If `window.confirm` was used, register a Playwright dialog handler (`win.on('dialog', d => d.accept())`) instead of clicking a modal button.

- [ ] **Step 2: Run + commit**

Run: `pnpm build && pnpm e2e tests/e2e/edit.spec.ts` (fully headless — SQLite needs no keychain). Expected: pass, `after` persisted.

```bash
git add tests/e2e/edit.spec.ts
git commit -m "test: edit-a-cell e2e (headless SQLite)"
```

---

## Self-Review (done at plan time)

1. **Spec coverage:** Capability + types (spec §1) → Task 1; preview + escaping (§1/§3) → Task 2; PG apply (§1) → Task 3; SQLite apply (§1) → Task 4; HostApi (§2) → Task 5; data tab + openTable (§4) → Task 6; editable grid + review + NULL (§4) → Task 7; tree/workbench wiring (§4) → Task 8; security (§5) is enforced in Tasks 2–4 (bound values, quoted idents, transaction); testing (§6): unit (2), contract (3,4,5), e2e (9). The spec's `previewEdits` HostApi method is intentionally replaced by a pure client-side function (documented deviation) — preview coverage is Task 2's unit tests.
2. **Placeholder scan:** No TBD/TODO. Full code in Tasks 1–6 and 9. Tasks 7–8 (Glide editable grid + tree activation) are acceptance-defined with pinned behavior — deliberate, because the exact `@glideapps/glide-data-grid` edit/overlay API and react-arborist activation vary by version; the `DataMutator`/`buildEdits`/`previewEdits`/`applyEdits` contracts they consume are fully specified.
3. **Type consistency:** `Cell`/`RowEdit`/`DataMutator` (Task 1) used verbatim in 2–7. `quoteIdent`/`renderLiteral`/`previewEdit`/`previewEdits`/`buildEdits`/`PendingEdits` (Task 2) consumed by mutators (3,4) and grid (7). `dataMutator` capability (1) implemented in 3/4, routed in 5. `mutationSupported`/`applyEdits` (5) consumed by the store (6) and grid (7). `QueryTab.kind`/`.data` + `openTable`/`applyEdits` (6) consumed by 7/8.

**Known deliberate deferrals:** preview is client-side pure (no RPC) — improves on the spec; the PG mutator shares the single query connection (BEGIN/COMMIT on it — fine, the data view isn't mid-cursor at apply time); no type-specific cell editors / FK dropdowns (MA2); the confirm dialog may be a minimal modal or `window.confirm` in v1; contract mutator tests run last in the describe so they don't disturb read assertions (fixture is re-seeded per run).

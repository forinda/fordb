# fordb MA2 Browse (Filter / Sort / FK Navigation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a table's data tab: filter per column, sort by clicking headers, and click a foreign-key value to open the referenced row — with bound values, on Postgres and SQLite.

**Architecture:** A `DataBrowser` adapter capability (`openBrowse(opts)`) builds an engine-correct parameterized `SELECT` via a pure `buildBrowseSql` and opens a cursor by reusing each adapter's existing cursor-open (refactored into a shared helper). The renderer sends structured `Filter[]`/`Sort[]`, never SQL. The data tab runs through `openBrowse`; the grid gains a filter row, sortable headers, and FK links.

**Tech Stack:** TypeScript strict, `pg`/`pg-cursor`, `@libsql/client`, `@glideapps/glide-data-grid`, React 19, Zustand, vitest, Playwright.

## Global Constraints

- pnpm; Node >= 22; TypeScript strict; no `any` except typed casts at the RPC/DB boundary.
- Filter values are **BOUND** (`$n` for PG, `?` for SQLite) — NEVER interpolated. Identifiers quoted via `quoteIdent` (`"`-escaped). The renderer sends structured filter/sort, never SQL.
- Capability-gated (`adapter.dataBrowser`): PG + SQLite now; engines without it fall back to the plain `openTable` SELECT (the data tab still works).
- Default sort = primary key (supplied by the caller in `browse.sort`); `buildBrowseSql` emits no `ORDER BY` when `sort` is empty.
- Filter/sort change with pending edits → confirm "discard N pending changes?" then clear pending.
- Secrets never reach the renderer.
- `@shared/*` alias. Renderer-importing tests → `tsconfig.web`; pure/db-host tests → `tsconfig.node`.
- Each task ends with `pnpm typecheck && pnpm lint && pnpm test` green (+ `pnpm build` for renderer tasks). Contract tasks run `pnpm db:up && pnpm test:contract && pnpm db:down`.
- One PR per task against `main`.

## File Structure (end state)

```
src/shared/adapter/browse-types.ts           # NEW: FilterOp, Filter, Sort, BrowseOptions, DataBrowser
src/shared/adapter/db-adapter.ts             # MODIFY: readonly dataBrowser?
src/shared/browse/build-browse.ts            # NEW: buildBrowseSql (pure, pg|sqlite)
src/db-host/postgres/postgres-browser.ts     # NEW: PgDataBrowser
src/db-host/postgres/postgres-adapter.ts     # MODIFY: openCursor helper + dataBrowser
src/db-host/sqlite/sqlite-browser.ts         # NEW: SqliteDataBrowser
src/db-host/sqlite/sqlite-adapter.ts         # MODIFY: openBuffered helper + dataBrowser
src/shared/host/host-api.ts                  # MODIFY: browseSupported/openBrowse
src/db-host/host-api-impl.ts                 # MODIFY: route them
src/renderer/src/store-query.ts              # MODIFY: browse state + fkColumns + openTable(initialFilters) + run-via-openBrowse + setBrowse + openFkTarget
src/renderer/src/components/TableDataGrid.tsx # MODIFY: filter row + sortable headers + FK links + pending guard
tests/unit/build-browse.test.ts              # NEW
tests/contract/adapter-contract.ts           # MODIFY: capability-gated browse block
tests/e2e/browse.spec.ts                     # NEW
```

---

### Task 1: Browse types + capability member

**Files:**

- Create: `src/shared/adapter/browse-types.ts`
- Modify: `src/shared/adapter/db-adapter.ts`

**Interfaces:**

- Produces: `FilterOp`, `Filter`, `Sort`, `BrowseOptions`, `DataBrowser`; `DbAdapter.dataBrowser?`.

- [ ] **Step 1: Types**

`src/shared/adapter/browse-types.ts`:

```ts
import type { OpenQueryResult } from './types'

export type FilterOp = 'eq' | 'ne' | 'lt' | 'gt' | 'le' | 'ge' | 'contains' | 'isNull' | 'isNotNull'

export interface Filter {
  column: string
  op: FilterOp
  value?: unknown // absent for isNull/isNotNull
}
export interface Sort {
  column: string
  dir: 'asc' | 'desc'
}
export interface BrowseOptions {
  schema: string
  table: string
  filters: Filter[] // AND-joined
  sort: Sort[] // in order; empty → no ORDER BY (caller supplies the pk default)
  pageSize: number
}

/** Optional structured-browse capability: builds a parameterized SELECT and
 *  opens a cursor (paged via the existing fetchPage/closeQuery). */
export interface DataBrowser {
  openBrowse(opts: BrowseOptions): Promise<OpenQueryResult>
}
```

- [ ] **Step 2: Capability member**

Modify `src/shared/adapter/db-adapter.ts` — add `import type { DataBrowser } from './browse-types'` and, after `dataMutator?`:

```ts
  /** Optional structured-browse capability (Postgres + SQLite). */
  readonly dataBrowser?: DataBrowser
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test` (green; types only).

```bash
git add src/shared/adapter/browse-types.ts src/shared/adapter/db-adapter.ts
git commit -m "feat: DataBrowser types + optional adapter capability"
```

---

### Task 2: Pure `buildBrowseSql`

**Files:**

- Create: `src/shared/browse/build-browse.ts`, `tests/unit/build-browse.test.ts`

**Interfaces:**

- Consumes: `BrowseOptions`, `Filter`, `Sort` (Task 1), `quoteIdent` (`@shared/mutation/build-edits`).
- Produces: `buildBrowseSql(opts: BrowseOptions, dialect: 'pg' | 'sqlite'): { sql: string; params: unknown[] }`.

- [ ] **Step 1: Failing tests**

`tests/unit/build-browse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildBrowseSql } from '../../src/shared/browse/build-browse'
import type { BrowseOptions } from '../../src/shared/adapter/browse-types'

const opts = (over: Partial<BrowseOptions>): BrowseOptions => ({
  schema: 'app',
  table: 'users',
  filters: [],
  sort: [],
  pageSize: 1000,
  ...over
})

describe('buildBrowseSql', () => {
  it('no filters/sort → plain select', () => {
    expect(buildBrowseSql(opts({}), 'pg')).toEqual({
      sql: `SELECT * FROM "app"."users"`,
      params: []
    })
  })
  it('pg: filters bound with $n, AND-joined', () => {
    const r = buildBrowseSql(
      opts({
        filters: [
          { column: 'id', op: 'ge', value: 5 },
          { column: 'email', op: 'contains', value: 'x' },
          { column: 'name', op: 'isNull' }
        ]
      }),
      'pg'
    )
    expect(r.sql).toBe(
      `SELECT * FROM "app"."users" WHERE "id" >= $1 AND "email" LIKE $2 AND "name" IS NULL`
    )
    expect(r.params).toEqual([5, '%x%'])
  })
  it('sqlite: placeholders are ?', () => {
    const r = buildBrowseSql(opts({ filters: [{ column: 'id', op: 'eq', value: 3 }] }), 'sqlite')
    expect(r.sql).toBe(`SELECT * FROM "app"."users" WHERE "id" = ?`)
    expect(r.params).toEqual([3])
  })
  it('sort → ORDER BY, multi-column in order', () => {
    const r = buildBrowseSql(
      opts({
        sort: [
          { column: 'name', dir: 'asc' },
          { column: 'id', dir: 'desc' }
        ]
      }),
      'pg'
    )
    expect(r.sql).toBe(`SELECT * FROM "app"."users" ORDER BY "name" ASC, "id" DESC`)
  })
  it('a quote in a value stays a bound param (no injection)', () => {
    const r = buildBrowseSql(
      opts({ filters: [{ column: 'email', op: 'eq', value: "x' OR '1'='1" }] }),
      'pg'
    )
    expect(r.sql).toBe(`SELECT * FROM "app"."users" WHERE "email" = $1`)
    expect(r.params).toEqual(["x' OR '1'='1"])
  })
})
```

- [ ] **Step 2: Run → FAIL** — `pnpm vitest run tests/unit/build-browse.test.ts`.

- [ ] **Step 3: Implement**

`src/shared/browse/build-browse.ts`:

```ts
import type { BrowseOptions, Filter, Sort } from '../adapter/browse-types'
import { quoteIdent } from '../mutation/build-edits'

const COMPARE: Record<string, string> = {
  eq: '=',
  ne: '<>',
  lt: '<',
  gt: '>',
  le: '<=',
  ge: '>=',
  contains: 'LIKE'
}

export function buildBrowseSql(
  opts: BrowseOptions,
  dialect: 'pg' | 'sqlite'
): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  const ph = (v: unknown): string => {
    params.push(v)
    return dialect === 'pg' ? `$${params.length}` : '?'
  }
  const where = opts.filters.map((f: Filter) => {
    const col = quoteIdent(f.column)
    if (f.op === 'isNull') return `${col} IS NULL`
    if (f.op === 'isNotNull') return `${col} IS NOT NULL`
    const bound = f.op === 'contains' ? ph(`%${String(f.value)}%`) : ph(f.value)
    return `${col} ${COMPARE[f.op]} ${bound}`
  })
  const order = opts.sort.map(
    (s: Sort) => `${quoteIdent(s.column)} ${s.dir === 'desc' ? 'DESC' : 'ASC'}`
  )
  let sql = `SELECT * FROM ${quoteIdent(opts.schema)}.${quoteIdent(opts.table)}`
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`
  if (order.length) sql += ` ORDER BY ${order.join(', ')}`
  return { sql, params }
}
```

- [ ] **Step 4: Run → PASS + commit**

Run: `pnpm vitest run tests/unit/build-browse.test.ts` (5 pass), then `pnpm typecheck && pnpm lint`.

```bash
git add src/shared/browse/build-browse.ts tests/unit/build-browse.test.ts
git commit -m "feat: pure buildBrowseSql (bound values, pg/sqlite dialects)"
```

---

### Task 3: PgDataBrowser (+ openCursor refactor) + contract test

**Files:**

- Create: `src/db-host/postgres/postgres-browser.ts`
- Modify: `src/db-host/postgres/postgres-adapter.ts`, `tests/contract/adapter-contract.ts`

**Interfaces:**

- Consumes: `DataBrowser`, `BrowseOptions`, `buildBrowseSql`, `OpenQueryResult`.
- Produces: `PgDataBrowser`; `PostgresAdapter.openCursor(sql, params, pageSize)`; `PostgresAdapter.dataBrowser`.

- [ ] **Step 1: Refactor openQuery → openCursor(sql, params, pageSize)**

In `src/db-host/postgres/postgres-adapter.ts`, extract the current `openQuery` body into a private method that takes params, and make `openQuery` delegate:

```ts
  private async openCursor(
    sql: string,
    params: unknown[],
    pageSize: number
  ): Promise<OpenQueryResult> {
    const cursor = this.conn.query(new Cursor(sql, params, { rowMode: 'array' }))
    const { rows, fields } = await new Promise<{
      rows: unknown[][]
      fields: { name: string; dataType: string }[]
    }>((resolve, reject) =>
      cursor.read(pageSize, (err, r, result) => {
        if (err) {
          reject(err)
          return
        }
        resolve({
          rows: r as unknown[][],
          fields: result.fields.map((f) => ({ name: f.name, dataType: String(f.dataTypeID) }))
        })
      })
    )
    const queryId = `q${this.nextCursorId++}`
    this.cursors.set(queryId, { cursor, fields, pageSize, pending: rows })
    return { queryId, fields }
  }

  async openQuery(sql: string, pageSize: number): Promise<OpenQueryResult> {
    return this.openCursor(sql, [], pageSize)
  }
```

(Keep the explanatory comment about `read(0)` inside `openCursor`.)

- [ ] **Step 2: PgDataBrowser**

`src/db-host/postgres/postgres-browser.ts`:

```ts
import type { DataBrowser, BrowseOptions } from '@shared/adapter/browse-types'
import type { OpenQueryResult } from '@shared/adapter/types'
import { buildBrowseSql } from '@shared/browse/build-browse'

export class PgDataBrowser implements DataBrowser {
  constructor(
    private readonly open: (
      sql: string,
      params: unknown[],
      pageSize: number
    ) => Promise<OpenQueryResult>
  ) {}

  openBrowse(opts: BrowseOptions): Promise<OpenQueryResult> {
    const { sql, params } = buildBrowseSql(opts, 'pg')
    return this.open(sql, params, opts.pageSize)
  }
}
```

- [ ] **Step 3: Wire onto the adapter**

In `postgres-adapter.ts`: import `PgDataBrowser` + `DataBrowser`, add next to `dataMutator`:

```ts
  readonly dataBrowser: DataBrowser = new PgDataBrowser((sql, params, ps) =>
    this.openCursor(sql, params, ps)
  )
```

- [ ] **Step 4: Capability-gated contract test**

In `tests/contract/adapter-contract.ts`, add AFTER the "reports indexes" test and BEFORE `executeQuery` (all reads; the mutator test still runs last):

```ts
it('data browser: filters (bound), contains, isNull, sort — no injection', async () => {
  if (!adapter.dataBrowser) return
  const s = expected.schema
  const page = async (o: Parameters<typeof adapter.dataBrowser.openBrowse>[0]) => {
    const open = await adapter.dataBrowser!.openBrowse(o)
    const p = await adapter.fetchPage(open.queryId)
    await adapter.closeQuery(open.queryId)
    return p.rows
  }
  // eq
  const eq = await page({
    schema: s,
    table: 'users',
    filters: [{ column: 'id', op: 'eq', value: 1 }],
    sort: [],
    pageSize: 1000
  })
  expect(eq).toHaveLength(1)
  // contains (email like %user5@%) → exactly user5@example.com
  const like = await page({
    schema: s,
    table: 'users',
    filters: [{ column: 'email', op: 'contains', value: 'user5@example.com' }],
    sort: [],
    pageSize: 1000
  })
  expect(like).toHaveLength(1)
  // isNull on a NOT NULL column → 0
  const nul = await page({
    schema: s,
    table: 'users',
    filters: [{ column: 'email', op: 'isNull' }],
    sort: [],
    pageSize: 1000
  })
  expect(nul).toHaveLength(0)
  // sort desc by id → first row is the max id
  const desc = await page({
    schema: s,
    table: 'users',
    filters: [],
    sort: [{ column: 'id', dir: 'desc' }],
    pageSize: 5
  })
  const all = await page({
    schema: s,
    table: 'users',
    filters: [],
    sort: [{ column: 'id', dir: 'asc' }],
    pageSize: 5
  })
  expect(Number(desc[0]?.[0])).toBeGreaterThan(Number(all[0]?.[0]))
  // injection attempt stays a bound value → 0 rows
  const inj = await page({
    schema: s,
    table: 'users',
    filters: [{ column: 'email', op: 'eq', value: "x' OR '1'='1" }],
    sort: [],
    pageSize: 1000
  })
  expect(inj).toHaveLength(0)
})
```

- [ ] **Step 5: Run + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm db:up && pnpm test:contract && pnpm db:down`. The browse test runs for PG (SQLite gated off until Task 4). Existing query/stream tests still pass (openQuery delegates to openCursor).

```bash
git add src/db-host/postgres/postgres-browser.ts src/db-host/postgres/postgres-adapter.ts tests/contract/adapter-contract.ts
git commit -m "feat: PgDataBrowser + openCursor refactor + browse contract test"
```

---

### Task 4: SqliteDataBrowser (+ openBuffered refactor)

**Files:**

- Create: `src/db-host/sqlite/sqlite-browser.ts`
- Modify: `src/db-host/sqlite/sqlite-adapter.ts`

**Interfaces:**

- Consumes: `DataBrowser`, `BrowseOptions`, `buildBrowseSql`, `@libsql/client` `InValue`.
- Produces: `SqliteDataBrowser`; `SqliteAdapter.openBuffered(sql, args, pageSize)`; `SqliteAdapter.dataBrowser`.

- [ ] **Step 1: Refactor openQuery → openBuffered(sql, args, pageSize)**

In `src/db-host/sqlite/sqlite-adapter.ts`, extract the execute+buffer into a helper taking args, and delegate:

```ts
  private async openBuffered(
    sql: string,
    args: import('@libsql/client').InValue[],
    pageSize: number
  ): Promise<OpenQueryResult> {
    const rs = await this.conn.execute({ sql, args })
    const fields = SqliteAdapter.fieldsOf(rs)
    const id = `c${this.nextCursor++}`
    this.cursors.set(id, { rows: SqliteAdapter.arrayRows(rs), fields, offset: 0, pageSize })
    return { queryId: id, fields }
  }

  async openQuery(sql: string, pageSize: number): Promise<OpenQueryResult> {
    return this.openBuffered(sql, [], pageSize)
  }
```

- [ ] **Step 2: SqliteDataBrowser**

`src/db-host/sqlite/sqlite-browser.ts`:

```ts
import type { InValue } from '@libsql/client'
import type { DataBrowser, BrowseOptions } from '@shared/adapter/browse-types'
import type { OpenQueryResult } from '@shared/adapter/types'
import { buildBrowseSql } from '@shared/browse/build-browse'

export class SqliteDataBrowser implements DataBrowser {
  constructor(
    private readonly open: (
      sql: string,
      args: InValue[],
      pageSize: number
    ) => Promise<OpenQueryResult>
  ) {}

  openBrowse(opts: BrowseOptions): Promise<OpenQueryResult> {
    const { sql, params } = buildBrowseSql(opts, 'sqlite')
    return this.open(sql, params as InValue[], opts.pageSize)
  }
}
```

- [ ] **Step 3: Wire onto the adapter**

In `sqlite-adapter.ts`: import `SqliteDataBrowser` + `DataBrowser`, add next to `dataMutator`:

```ts
  readonly dataBrowser: DataBrowser = new SqliteDataBrowser((sql, args, ps) =>
    this.openBuffered(sql, args, ps)
  )
```

- [ ] **Step 4: Run the browse contract for SQLite + commit**

The Task-3 browse test is capability-gated + schema-parameterized, so it now runs for SQLite too. Run: `pnpm vitest run -c vitest.contract.config.ts tests/contract/sqlite.contract.test.ts` (browse test passes for SQLite), then `pnpm db:up && pnpm test:contract && pnpm db:down`, `pnpm typecheck && pnpm lint && pnpm test`.

```bash
git add src/db-host/sqlite/sqlite-browser.ts src/db-host/sqlite/sqlite-adapter.ts
git commit -m "feat: SqliteDataBrowser + openBuffered refactor + contract coverage"
```

---

### Task 5: HostApi browse surface + routing

**Files:**

- Modify: `src/shared/host/host-api.ts`, `src/db-host/host-api-impl.ts`

**Interfaces:**

- Produces: `HostApi.browseSupported(id)`, `HostApi.openBrowse(id, opts)`.

- [ ] **Step 1: Interface**

Modify `src/shared/host/host-api.ts`: `import type { BrowseOptions } from '../adapter/browse-types'`, add after `applyEdits`:

```ts
  browseSupported(id: ConnectionId): Promise<boolean>
  openBrowse(id: ConnectionId, opts: BrowseOptions): Promise<OpenQueryResult>
```

- [ ] **Step 2: Routing**

Modify `src/db-host/host-api-impl.ts`: import `BrowseOptions` + `DataBrowser`, add:

```ts
  private browser(id: ConnectionId): DataBrowser {
    const b = this.registry.get(id).dataBrowser
    if (!b) throw new Error('Structured browse is not supported by this engine')
    return b
  }
  async browseSupported(id: ConnectionId): Promise<boolean> {
    return this.registry.get(id).dataBrowser != null
  }
  openBrowse(id: ConnectionId, opts: BrowseOptions): Promise<OpenQueryResult> {
    return this.browser(id).openBrowse(opts)
  }
```

- [ ] **Step 3: host-api contract assertion**

In `tests/contract/host-api.contract.test.ts`, add:

```ts
it('browses over the HostApi with a filter', async () => {
  const id = await client.openConnection(profile)
  expect(await client.browseSupported(id)).toBe(true)
  const open = await client.openBrowse(id, {
    schema: 'app',
    table: 'users',
    filters: [{ column: 'id', op: 'eq', value: 4 }],
    sort: [],
    pageSize: 1000
  })
  const page = await client.fetchPage(id, open.queryId)
  await client.closeQuery(id, open.queryId)
  expect(page.rows).toHaveLength(1)
  await client.closeConnection(id)
})
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm db:up && pnpm test:contract && pnpm db:down`.

```bash
git add src/shared/host/host-api.ts src/db-host/host-api-impl.ts tests/contract/host-api.contract.test.ts
git commit -m "feat: HostApi browseSupported + openBrowse routing"
```

---

### Task 6: Store — browse state, run-via-openBrowse, setBrowse, FK target

**Files:**

- Modify: `src/renderer/src/store-query.ts`

**Interfaces:**

- Consumes: `hostApi()`, `Filter`, `Sort`, `BrowseOptions`, `QueryResultSource`, `getKeys`.
- Produces: `QueryTab.data.browse`/`.fkColumns`; `openTable(schema, table, initialFilters?)`; `setBrowse(tabId, browse)`; `openFkTarget(schema, refTable, value)`.

- [ ] **Step 1: Extend the data-tab shape + actions**

Modify `src/renderer/src/store-query.ts`:

- Import `Filter, Sort` from `@shared/adapter/browse-types`.
- `QueryTab.data` becomes `{ schema; table; pkColumns; editable; browse: { filters: Filter[]; sort: Sort[] }; fkColumns: Record<string, string> }` (fkColumns maps a local column → referenced table).
- `openTable(schema, table, initialFilters?: Filter[])`:

```ts
  openTable: async (schema, table, initialFilters) => {
    const connId = useConnStore.getState().activeConnectionId
    if (!connId) return
    const api = await hostApi()
    const [keys, mutable] = await Promise.all([
      api.getKeys(connId, schema, table),
      api.mutationSupported(connId)
    ])
    const pk = keys.find((k) => k.kind === 'primary') ?? keys.find((k) => k.kind === 'unique')
    const pkColumns = pk?.columns ?? []
    const fkColumns: Record<string, string> = {}
    for (const k of keys)
      if (k.kind === 'foreign' && k.columns.length === 1 && k.referencedTable)
        fkColumns[k.columns[0]!] = k.referencedTable
    const id = tabId()
    const tab: QueryTab = {
      id,
      sql: `browse ${schema}.${table}`,
      status: 'idle',
      kind: 'data',
      data: {
        schema,
        table,
        pkColumns,
        editable: mutable && pkColumns.length > 0,
        fkColumns,
        browse: { filters: initialFilters ?? [], sort: pkColumns.map((c) => ({ column: c, dir: 'asc' as const })) }
      }
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
    await get().run(id)
  },
  setBrowse: (tabId, browse) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId && t.data ? { ...t, data: { ...t.data, browse } } : t))
    }))
    void get().run(tabId)
  },
  openFkTarget: async (schema, refTable, value) => {
    const connId = useConnStore.getState().activeConnectionId
    if (!connId) return
    const keys = await (await hostApi()).getKeys(connId, schema, refTable)
    const pk = keys.find((k) => k.kind === 'primary')
    const filters = pk && pk.columns.length === 1 ? [{ column: pk.columns[0]!, op: 'eq' as const, value }] : []
    await get().openTable(schema, refTable, filters)
  },
```

- Add these to `QueryState`: `openTable: (schema, table, initialFilters?: Filter[]) => Promise<void>`, `setBrowse: (tabId: string, browse: { filters: Filter[]; sort: Sort[] }) => void`, `openFkTarget: (schema: string, refTable: string, value: unknown) => Promise<void>`.

- [ ] **Step 2: run() uses openBrowse for data tabs**

In `run()`, the SELECT branch currently does `api.openQuery(connId, tab.sql, PAGE_SIZE)`. For a data tab, use `openBrowse`:

```ts
if (tab.kind === 'data' && tab.data) {
  const open = await api.openBrowse(connId, {
    schema: tab.data.schema,
    table: tab.data.table,
    filters: tab.data.browse.filters,
    sort: tab.data.browse.sort,
    pageSize: PAGE_SIZE
  })
  const source = new QueryResultSource(
    { fetchPage: (q) => api.fetchPage(connId, q), closeQuery: (q) => api.closeQuery(connId, q) },
    open.queryId,
    open.fields,
    PAGE_SIZE
  )
  set((s) => ({ tabs: patch(s.tabs, id, { source }) }))
  await source.ensureLoaded(0)
  set((s) => ({
    tabs: patch(s.tabs, id, { status: 'done', elapsedMs: performance.now() - started })
  }))
  return
}
```

Place this as the first branch inside the `try` (before the `isSelectLike` branch). Query tabs keep the existing path.

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

```bash
git add src/renderer/src/store-query.ts
git commit -m "feat: data-tab browse state + openBrowse run path + setBrowse + FK target"
```

---

### Task 7: Grid — filter row, sortable headers, FK links

**Files:**

- Modify: `src/renderer/src/components/TableDataGrid.tsx`

**Interfaces:**

- Consumes: `setBrowse`/`openFkTarget` (Task 6), `tab.data.browse`/`.fkColumns`, Glide `onHeaderClicked`/`onCellClicked`.

**Acceptance (Glide specifics may vary — implement whichever the installed version supports cleanly, keeping this behavior):**

- **Filter bar** above the grid: for each column, an op `<select>` (`= ≠ < > ≤ ≥ contains is null is not null`) + a value `<input>`; Enter (or an Apply button) builds `Filter[]` from entries that have a value (or a null op) → guarded `setBrowse({ filters, sort })`. A thin plain-HTML bar mapping to columns is acceptable (don't fight Glide's header API).
- **Sort:** `onHeaderClicked(col)` cycles that column `asc → desc → removed` in `browse.sort` (single-column in v1) → guarded `setBrowse`. Active sort shows ↑/↓ in a header label.
- **FK links:** for columns in `tab.data.fkColumns`, render the cell with a link color (`themeOverride`); `onCellClicked([col,row])` → if it's a FK column and the value is non-null → `openFkTarget(tab.data.schema, fkColumns[colName], value)`.
- **Pending guard:** wrap every `setBrowse` call so that if `dirty > 0`, `window.confirm('Discard ' + dirty + ' pending changes?')`; on confirm clear pending then `setBrowse`; else no-op.

- [ ] **Step 1: Implement the filter bar + sort + FK wiring**

Build per the acceptance. Read `browse` from `tab.data.browse`; keep filter-bar input state local, commit to `setBrowse` on Enter/Apply. Reuse `colName`/`fields`. FK column set = `new Set(Object.keys(tab.data.fkColumns))`.

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Report which Glide APIs you used.

```bash
git add src/renderer/src/components/TableDataGrid.tsx
git commit -m "feat: filter row, sortable headers, FK links in the data grid"
```

---

### Task 8: Browse e2e (headless SQLite)

**Files:**

- Create: `tests/e2e/browse.spec.ts`

**Interfaces:**

- Consumes: the running app + a temp SQLite file with a filterable table.

- [ ] **Step 1: e2e**

`tests/e2e/browse.spec.ts` — connect SQLite, open a table, apply a filter, assert the DOM reflects fewer rows (via the row-count marker or a known-gone value). Use a fresh `--user-data-dir` (headless profiles persist):

```ts
import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('filter a table in the data grid', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-browse-')), 'b.sqlite')
  const db = createClient({ url: `file:${file}` })
  await db.executeMultiple(
    `CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT);
     INSERT INTO widgets (label) VALUES ('apple'), ('banana'), ('avocado');`
  )
  db.close()
  const userData = mkdtempSync(join(tmpdir(), 'fordb-ud-'))

  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByRole('combobox', { name: 'Database engine' }).click()
  await win.getByRole('option', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('browse-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Save').click()
  await win.getByText('browse-sqlite').click()

  await win.getByText('main', { exact: true }).click()
  await win.getByText('widgets').click() // opens data tab
  await expect(win.getByText('Review & apply')).toBeVisible({ timeout: 15000 })

  // Filter label contains 'a' → all three match; contains 'ban' → 1. Assert via
  // the filter bar existing + applying doesn't error. (Glide cells are canvas,
  // so we assert the DOM-observable filter control, not grid cell text.)
  const opSelect = win.getByLabel('filter-op-label').first()
  await expect(opSelect).toBeVisible()

  await app.close()
})
```

Adjust the filter-control selector to what Task 7 renders (give the filter op-select an `aria-label` like `filter-op-<column>` so the e2e can target it). Because Glide renders cells to canvas, assert the DOM filter control renders + the tab is live; filter _correctness_ is covered by the contract test.

- [ ] **Step 2: Run + commit**

Run: `pnpm build && pnpm e2e tests/e2e/browse.spec.ts` (headless — SQLite needs no keychain).

```bash
git add tests/e2e/browse.spec.ts
git commit -m "test: browse/filter e2e (headless SQLite)"
```

---

## Self-Review (done at plan time)

1. **Spec coverage:** Capability + types (spec §1) → Task 1; `buildBrowseSql` (§2) → Task 2; PG impl (§3) → Task 3; SQLite impl (§3) → Task 4; HostApi (§4) → Task 5; store browse state + openTable/setBrowse/FK (§5) → Task 6; grid filter/sort/FK/pending-guard (§6) → Task 7; security (§7) enforced in Tasks 2–4 (bound values, quoted idents) + contract injection test (3); testing (§8): unit (2), contract (3,4,5), e2e (8).
2. **Placeholder scan:** No TBD/TODO; full code in Tasks 1–6 and 8. Task 7 (Glide filter row / sortable headers / FK links) is acceptance-defined with pinned behavior — deliberate (the exact Glide header/cell-click API varies by version); the `setBrowse`/`openFkTarget`/`buildBrowseSql` contracts it consumes are fully specified.
3. **Type consistency:** `Filter`/`Sort`/`BrowseOptions`/`DataBrowser` (Task 1) used verbatim in 2–7. `buildBrowseSql(opts, dialect)` (Task 2) consumed by both browsers (3,4). `openCursor(sql,params,pageSize)` / `openBuffered(sql,args,pageSize)` (3,4) match their `PgDataBrowser`/`SqliteDataBrowser` constructors. `browseSupported`/`openBrowse` (5) consumed by the store (6). `QueryTab.data.browse`/`.fkColumns` + `openTable(…, initialFilters?)`/`setBrowse`/`openFkTarget` (6) consumed by the grid (7).

**Known deliberate deferrals:** single-column sort UI (the `Sort[]` type allows multi); reverse-FK + DB-wide search (MA2b); FK→PK assumption with unfiltered fallback; filter bar is plain HTML above the grid (not Glide's header) to avoid header-API fiddliness; browse contract test placed among the read tests so it precedes the (last) mutator test on the shared fixture.

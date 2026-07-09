# fordb SQLite Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second engine — a `SqliteAdapter` implementing the full `DbAdapter` contract (browse, query, cursor-stream), addressed by a file-path profile, registered by engine, with the server-stats Dashboard hidden for SQLite.

**Architecture:** `ConnectionProfile` becomes a discriminated union (`PostgresProfile | SqliteProfile`). A `SqliteAdapter` wraps better-sqlite3 (sync → async), mapping the contract's "schema" to SQLite's attached-database name. An `adapterForEngine` factory dispatches by engine. The renderer wires `serverStatsSupported` to hide the Dashboard tab.

**Tech Stack:** TypeScript strict, better-sqlite3 (fallback @libsql/client), Electron, React 19, vitest, Playwright.

## Global Constraints

- pnpm; Node >= 22; TypeScript strict; no `any` except typed casts at the RPC/serialization / DB-row boundary.
- Secrets never reach the renderer, never persisted in profiles.json. SQLite profiles are structurally secretless.
- The discriminated union is the safety net: consumers that read `.host`/`.user`/`.database`/`.password`/`.ssh` must narrow on `.engine` or they fail to compile.
- SQLite "schema" = attached-database name (`PRAGMA database_list`); a plain file shows `main`.
- Read-only Dashboard degrades: SqliteAdapter omits the optional `serverStats`; the renderer hides the Dashboard tab when `serverStatsSupported(connId)` is false.
- Charts/CSP/theme constraints unchanged (not touched here).
- `@shared/*` alias for shared imports. Renderer-importing tests route through `tsconfig.web` (excluded from `tsconfig.node`); pure/shared/db-host tests stay on `tsconfig.node`.
- Each task ends with `pnpm typecheck && pnpm lint && pnpm test` green (+ `pnpm build` for renderer/build-touching tasks). Contract tasks run `pnpm db:up && pnpm test:contract && pnpm db:down`.
- **Driver decision (Task 1):** better-sqlite3 primary; if the ABI spike is unworkable, auto-switch to `@libsql/client` (N-API) — same `SqliteAdapter` shape, async API — and record it in the ledger + spec.
- One PR per task against `main`.

## File Structure (end state)

```
src/shared/adapter/types.ts                 # MODIFY: ConnectionProfile → PostgresProfile | SqliteProfile
src/shared/connection-label.ts              # MODIFY: SQLite basename label
src/shared/connection-url.ts                # MODIFY: Partial<PostgresProfile>
src/db-host/adapter-factory.ts              # NEW: adapterForEngine(engine)
src/db-host/connection-registry.ts          # MODIFY: makeAdapter(engine)
src/db-host/connect-with-tunnel.ts          # MODIFY: makeAdapter(engine); narrow ssh to postgres
src/db-host/host-api-impl.ts                # MODIFY: testConnection via adapterForEngine
src/db-host/postgres/postgres-adapter.ts     # MODIFY: connect() narrows to postgres profile
src/db-host/sqlite/sqlite-sql.ts             # NEW: PRAGMA / sqlite_master strings
src/db-host/sqlite/sqlite-adapter.ts         # NEW: SqliteAdapter
src/main/profile-store.ts                    # MODIFY: engine-switched secret strip
src/main/ipc.ts                              # MODIFY: dialog:open-file
src/preload/index.ts                         # MODIFY: window.fordb.dialog.openFile
src/renderer/src/rpc.ts                      # MODIFY: dialog type on Window.fordb
src/renderer/src/query/stats.ts              # MODIFY: useServerStatsSupported
src/renderer/src/components/ProfileForm.tsx  # MODIFY: engine selector + file/Browse
src/renderer/src/App.tsx                     # MODIFY: hide Dashboard tab when unsupported
electron.vite.config.ts                      # MODIFY: better-sqlite3 external
package.json / pnpm-workspace.yaml           # MODIFY: dep + native-build allowlist + rebuild scripts
tests/contract/adapter-contract.ts           # MODIFY: expected {database,schema} param
tests/contract/postgres.contract.test.ts     # MODIFY: pass expected
tests/contract/sqlite-fixture.ts             # NEW: builds a temp SQLite fixture
tests/contract/sqlite.contract.test.ts       # NEW
tests/unit/adapter-factory.test.ts           # NEW
tests/e2e/sqlite.spec.ts                     # NEW
```

---

### Task 1: better-sqlite3 ABI spike + build wiring

**Files:**

- Modify: `package.json`, `pnpm-workspace.yaml`, `electron.vite.config.ts`, `CONTRIBUTING.md`
- Create: `tests/unit/sqlite-driver.test.ts` (a smoke test that doubles as the Node-ABI proof)

**Interfaces:**

- Produces: a working `better-sqlite3` install loadable in BOTH vitest (Node) and the db-host (Electron), the pinned rebuild workflow, and a recorded driver decision.

- [ ] **Step 1: Install + allow the native build**

```bash
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3
```

better-sqlite3 is a native module; pnpm blocks its build script by default. Add it to the build allowlist in `pnpm-workspace.yaml`:

```yaml
onlyBuiltDependencies:
  - better-sqlite3
```

(Keep any existing entries.) Then `pnpm rebuild better-sqlite3` to compile it for the current Node.

- [ ] **Step 2: Node-ABI smoke test (the automated proof)**

`tests/unit/sqlite-driver.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'

describe('better-sqlite3 loads under Node (vitest)', () => {
  it('opens an in-memory db and runs a query', () => {
    const db = new Database(':memory:')
    const row = db.prepare('SELECT 1 AS one').get() as { one: number }
    expect(row.one).toBe(1)
    db.close()
  })
})
```

Run: `pnpm vitest run tests/unit/sqlite-driver.test.ts` — must PASS (proves the Node build works for tests/CI).

- [ ] **Step 3: Mark better-sqlite3 external in the db-host build**

Modify `electron.vite.config.ts` — add `'better-sqlite3'` to the `main` build's `rollupOptions.external` array (it currently lists `['pg-native', 'cpu-features']`):

```ts
external: ['pg-native', 'cpu-features', 'better-sqlite3']
```

This keeps the native `require` intact (not bundled), same as `pg-native`.

- [ ] **Step 4: Prove the Electron-ABI load (manual, gated)**

Add a temporary probe to `src/db-host/index.ts` at the top of the module (remove before commit):

```ts
// TEMP spike probe — remove before commit.
import Database from 'better-sqlite3'
console.log(
  '[spike] better-sqlite3 in db-host:',
  new Database(':memory:').prepare('SELECT 1 AS n').get()
)
```

Then, with better-sqlite3 rebuilt for Electron (`pnpm exec electron-rebuild -f -w better-sqlite3` OR `pnpm exec electron-builder install-app-deps`), run `pnpm dev:sandboxless` and confirm the `[spike]` line prints `{ n: 1 }` in the terminal (db-host stdout) with no ABI error.

**Decision gate:**

- If both proofs pass and the rebuild workflow is tolerable → keep better-sqlite3. Remove the probe.
- If the Electron rebuild ABI-breaks the vitest build (or vice-versa) and can't be reconciled with two scripts → **switch to `@libsql/client`**: `pnpm remove better-sqlite3 @types/better-sqlite3 && pnpm add @libsql/client`, drop it from `external`/allowlist, rewrite Step 2's smoke test against `createClient({ url: ':memory:' })`, and note in the report + ledger that Tasks 4/5 use the libsql async API (`client.execute(sql)` → `{ rows, columns }`). Everything else in this plan is unchanged.

- [ ] **Step 5: Document the workflow + rebuild scripts**

Add to `package.json` scripts (better-sqlite3 path):

```json
"rebuild:electron": "electron-rebuild -f -w better-sqlite3",
"rebuild:node": "pnpm rebuild better-sqlite3"
```

Add a short "Native modules (better-sqlite3)" note to `CONTRIBUTING.md`: tests/CI use the Node build (default); before `pnpm dev` or packaging run `pnpm rebuild:electron`; `pnpm rebuild:node` to switch back for tests. (If libsql was chosen, document instead that it needs no rebuild.)

- [ ] **Step 6: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Confirm the temp probe is removed (`git grep '\[spike\]'` returns nothing).

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml electron.vite.config.ts CONTRIBUTING.md tests/unit/sqlite-driver.test.ts
git commit -m "chore: sqlite driver (better-sqlite3) + ABI build workflow"
```

---

### Task 2: ConnectionProfile discriminated union + narrow all consumers

**Files:**

- Modify: `src/shared/adapter/types.ts`, `src/shared/connection-label.ts`, `src/shared/connection-url.ts`, `src/main/profile-store.ts`, `src/db-host/postgres/postgres-adapter.ts`, `src/db-host/connect-with-tunnel.ts`
- Test: `tests/unit/connection-label.test.ts` (NEW), plus existing `connection-url.test.ts` stays green

**Interfaces:**

- Produces: `PostgresProfile`, `SqliteProfile`, `ConnectionProfile = PostgresProfile | SqliteProfile`.
- Consumes: nothing new; this is a type change + narrowing across consumers.

- [ ] **Step 1: The union**

Modify `src/shared/adapter/types.ts` — replace the single `ConnectionProfile` interface with:

```ts
interface BaseProfile {
  id: string
  name: string
}
export interface PostgresProfile extends BaseProfile {
  engine: 'postgres'
  host: string
  port: number
  database: string
  user: string
  // SECRETS — transient, injected at connect, NEVER persisted (stripped in
  // ProfileStore.save()).
  password?: string
  sshPassword?: string
  sshPassphrase?: string
  ssl?: SslOptions
  ssh?: SshOptions
}
export interface SqliteProfile extends BaseProfile {
  engine: 'sqlite'
  file: string
}
export type ConnectionProfile = PostgresProfile | SqliteProfile
```

Keep `SslOptions`/`SshOptions` as-is above it.

- [ ] **Step 2: connection-label narrows on engine (write the test first)**

`tests/unit/connection-label.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { connectionLabel } from '../../src/shared/connection-label'

describe('connectionLabel', () => {
  it('uses the name when set (postgres)', () => {
    expect(
      connectionLabel({
        id: '1',
        name: 'prod',
        engine: 'postgres',
        host: 'h',
        port: 5432,
        database: 'd',
        user: 'u'
      })
    ).toBe('prod')
  })
  it('falls back to user@host/database (postgres)', () => {
    expect(
      connectionLabel({
        id: '1',
        name: '',
        engine: 'postgres',
        host: 'h',
        port: 5432,
        database: 'd',
        user: 'u'
      })
    ).toBe('u@h/d')
  })
  it('falls back to the file basename (sqlite)', () => {
    expect(connectionLabel({ id: '1', name: '', engine: 'sqlite', file: '/tmp/app.sqlite' })).toBe(
      'app.sqlite'
    )
  })
})
```

Run: `pnpm vitest run tests/unit/connection-label.test.ts` → FAIL (sqlite branch missing / type error).

- [ ] **Step 3: Implement the narrowed label**

`src/shared/connection-label.ts`:

```ts
import type { ConnectionProfile } from './adapter/types'

/** A human label for a connection profile. Profiles may be saved without a
 *  name, so fall back to an engine-appropriate identifier. */
export function connectionLabel(profile: ConnectionProfile): string {
  const name = profile.name.trim()
  if (name) return name
  if (profile.engine === 'sqlite') {
    const base = profile.file.split(/[\\/]/).pop() ?? profile.file
    return base || 'SQLite database'
  }
  const host = profile.host.trim()
  const user = profile.user.trim()
  const database = profile.database.trim()
  if (!host && !user && !database) return 'Unnamed connection'
  const left = user ? `${user}@${host}` : host
  return database ? `${left}/${database}` : left
}
```

- [ ] **Step 4: connection-url returns Partial<PostgresProfile>**

Modify `src/shared/connection-url.ts` — change the two `Partial<ConnectionProfile>` annotations (the `ParsedUrl.profile` field and the local `const profile`) to `Partial<PostgresProfile>` and import `PostgresProfile`. The `engine: 'postgres'` literal already set stays. This keeps `connection-url.test.ts` green (it asserts host/port/etc. on a postgres shape).

- [ ] **Step 5: profile-store engine-switched strip**

Modify `src/main/profile-store.ts` `save()` — the current destructure `{ password, sshPassword, sshPassphrase, ...safe }` no longer type-checks against the union. Replace with an engine switch:

```ts
  async save(profile: ConnectionProfile): Promise<void> {
    // Strip secrets before persisting. SQLite has none (structurally); Postgres
    // secrets are omitted by destructuring so a new secret field added to the
    // type fails to compile here until handled.
    const safe: ConnectionProfile =
      profile.engine === 'postgres'
        ? (({ password: _pw, sshPassword: _sp, sshPassphrase: _pp, ...rest }) => rest)(profile)
        : profile
    // …rest of save() unchanged, using `safe` where it used the stripped object.
  }
```

(Preserve the existing read-list / findIndex / write logic below, operating on `safe`.)

- [ ] **Step 6: PostgresAdapter.connect narrows**

Modify `src/db-host/postgres/postgres-adapter.ts`:

- `clientConfig(profile: PostgresProfile)` — change the param type from `ConnectionProfile` to `PostgresProfile` (import it).
- `connect(profile: ConnectionProfile)` — add at the top: `if (profile.engine !== 'postgres') throw new Error('PostgresAdapter requires a postgres profile')` then pass the narrowed `profile` to `clientConfig`. Assign `this.profile = profile` (now typed `PostgresProfile`; adjust the field type if it was `ConnectionProfile`).

- [ ] **Step 7: connect-with-tunnel narrows ssh + threads engine**

Modify `src/db-host/connect-with-tunnel.ts`:

- Signature: `makeAdapter: (engine: ConnectionProfile['engine']) => DbAdapter`.
- Guard the ssh block on postgres: `if (profile.engine === 'postgres' && profile.ssh) { … effective = { ...profile, host: '127.0.0.1', port: tunnel.localPort } }` (the spread is valid inside the postgres narrowing).
- Call `adapter = makeAdapter(profile.engine)`.

- [ ] **Step 8: Verify (compile is the net) + commit**

Run: `pnpm typecheck` — this is the key gate; every un-narrowed consumer surfaces here. Fix any straggler by narrowing on `.engine`. Then `pnpm lint && pnpm test` (connection-label 3 new + all existing green — note `ConnectionRegistry`/`HostApiImpl` callers of `makeAdapter`/`connectAdapter` will now type-error; they are updated in Task 3/5 — if the tree must compile at each task, include the one-line call-site signature bump here and finish the behavior in Task 5). To keep this task self-consistent, also update the two `makeAdapter` construction sites minimally: `ConnectionRegistry` field type and `HostApiImpl.testConnection`'s `() => new PostgresAdapter()` → `(engine) => engine === 'postgres' ? new PostgresAdapter() : (() => { throw new Error('sqlite adapter not wired yet') })()`. (Task 5 replaces that stub with `adapterForEngine`.)

```bash
git add src/shared/adapter/types.ts src/shared/connection-label.ts src/shared/connection-url.ts src/main/profile-store.ts src/db-host/postgres/postgres-adapter.ts src/db-host/connect-with-tunnel.ts src/db-host/connection-registry.ts src/db-host/host-api-impl.ts tests/unit/connection-label.test.ts
git commit -m "feat: ConnectionProfile discriminated union (postgres | sqlite)"
```

---

### Task 3: Parameterize the adapter contract with `expected`

**Files:**

- Modify: `tests/contract/adapter-contract.ts`, `tests/contract/postgres.contract.test.ts`

**Interfaces:**

- Produces: `runAdapterContractTests(makeAdapter: () => DbAdapter, profile: ConnectionProfile, expected: { database: string; schema: string })`.

- [ ] **Step 1: Thread `expected` through the assertions**

Modify `tests/contract/adapter-contract.ts` — add the third param and replace the two hard-coded literals:

- Signature: `export function runAdapterContractTests(makeAdapter: () => DbAdapter, profile: ConnectionProfile, expected: { database: string; schema: string }): void`.
- `expect(dbs).toContain(profile.database)` → `expect(dbs).toContain(expected.database)`.
- Every `'app'` literal (the `listSchemas` assertion and each `listTables('app')`/`getColumns('app', …)`/`getKeys('app', …)`/`getIndexes('app', …)` call) → `expected.schema`.

- [ ] **Step 2: Update the Postgres caller**

Modify `tests/contract/postgres.contract.test.ts` — the final line:

```ts
runAdapterContractTests(() => new PostgresAdapter(), profile, {
  database: 'fordb_test',
  schema: 'app'
})
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm db:up && pnpm test:contract && pnpm db:down` — 28 contract tests still pass (behavior identical). `pnpm typecheck && pnpm lint`.

```bash
git add tests/contract/adapter-contract.ts tests/contract/postgres.contract.test.ts
git commit -m "test: parameterize adapter contract with expected {database,schema}"
```

---

### Task 4: SqliteAdapter + SQL + fixture + contract test

**Files:**

- Create: `src/db-host/sqlite/sqlite-sql.ts`, `src/db-host/sqlite/sqlite-adapter.ts`, `tests/contract/sqlite-fixture.ts`, `tests/contract/sqlite.contract.test.ts`

**Interfaces:**

- Consumes: `DbAdapter`, `ConnectionProfile`/`SqliteProfile`, result types (`TableInfo`/`ColumnInfo`/`KeyInfo`/`IndexInfo`/`QueryResult`/`OpenQueryResult`/`Page`/`FieldInfo`) from `@shared/adapter/*`; better-sqlite3.
- Produces: `class SqliteAdapter implements DbAdapter`.

- [ ] **Step 1: SQL strings**

`src/db-host/sqlite/sqlite-sql.ts`:

```ts
// Identifiers (schema/table) are quoted and interpolated because SQLite PRAGMA
// and attached-schema references don't accept bind parameters. Only names from
// the catalog (listSchemas/listTables) are ever passed.
export const DATABASE_LIST = `PRAGMA database_list`
export const listTables = (schema: string): string =>
  `SELECT name, type FROM "${schema}".sqlite_master
   WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`
export const tableInfo = (schema: string, table: string): string =>
  `PRAGMA "${schema}".table_info("${table}")`
export const foreignKeyList = (schema: string, table: string): string =>
  `PRAGMA "${schema}".foreign_key_list("${table}")`
export const indexList = (schema: string, table: string): string =>
  `PRAGMA "${schema}".index_list("${table}")`
export const indexInfo = (schema: string, index: string): string =>
  `PRAGMA "${schema}".index_info("${index}")`
```

- [ ] **Step 2: SqliteAdapter**

`src/db-host/sqlite/sqlite-adapter.ts`:

```ts
import Database from 'better-sqlite3'
import type { DbAdapter } from '@shared/adapter/db-adapter'
import type {
  ColumnInfo,
  ConnectionProfile,
  FieldInfo,
  IndexInfo,
  KeyInfo,
  OpenQueryResult,
  Page,
  QueryResult,
  TableInfo
} from '@shared/adapter/types'
import * as SQL from './sqlite-sql'

type Row = Record<string, unknown>

export class SqliteAdapter implements DbAdapter {
  private db: Database.Database | null = null
  private cursors = new Map<string, { iter: Iterator<unknown[]>; fields: FieldInfo[] }>()
  private nextCursor = 1

  private get conn(): Database.Database {
    if (!this.db) throw new Error('Not connected')
    return this.db
  }

  async connect(profile: ConnectionProfile): Promise<void> {
    if (profile.engine !== 'sqlite') throw new Error('SqliteAdapter requires a sqlite profile')
    this.db = new Database(profile.file)
  }
  async disconnect(): Promise<void> {
    this.db?.close()
    this.db = null
  }

  async listDatabases(): Promise<string[]> {
    return (this.conn.prepare(SQL.DATABASE_LIST).all() as Row[]).map((r) => String(r.name))
  }
  async listSchemas(): Promise<string[]> {
    return this.listDatabases()
  }
  async listTables(schema: string): Promise<TableInfo[]> {
    return (this.conn.prepare(SQL.listTables(schema)).all() as Row[]).map((r) => ({
      schema,
      name: String(r.name),
      type: r.type === 'view' ? 'view' : 'table'
    }))
  }
  async getColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    return (this.conn.prepare(SQL.tableInfo(schema, table)).all() as Row[]).map((r) => ({
      name: String(r.name),
      dataType: String(r.type ?? ''),
      nullable: Number(r.notnull) === 0,
      defaultValue: r.dflt_value == null ? null : String(r.dflt_value),
      ordinal: Number(r.cid) + 1
    }))
  }
  async getKeys(schema: string, table: string): Promise<KeyInfo[]> {
    const keys: KeyInfo[] = []
    const cols = this.conn.prepare(SQL.tableInfo(schema, table)).all() as Row[]
    const pk = cols
      .filter((c) => Number(c.pk) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk))
      .map((c) => String(c.name))
    if (pk.length)
      keys.push({ name: 'primary', kind: 'primary', columns: pk, referencedTable: null })

    const fks = this.conn.prepare(SQL.foreignKeyList(schema, table)).all() as Row[]
    const byId = new Map<number, { columns: string[]; ref: string }>()
    for (const r of fks) {
      const id = Number(r.id)
      const e = byId.get(id) ?? { columns: [], ref: String(r.table) }
      e.columns.push(String(r.from))
      byId.set(id, e)
    }
    for (const [id, e] of byId)
      keys.push({ name: `fk_${id}`, kind: 'foreign', columns: e.columns, referencedTable: e.ref })

    const idxs = this.conn.prepare(SQL.indexList(schema, table)).all() as Row[]
    for (const idx of idxs) {
      if (Number(idx.unique) !== 1 || idx.origin !== 'u') continue
      const name = String(idx.name)
      const columns = (this.conn.prepare(SQL.indexInfo(schema, name)).all() as Row[]).map((r) =>
        String(r.name)
      )
      keys.push({ name, kind: 'unique', columns, referencedTable: null })
    }
    return keys
  }
  async getIndexes(schema: string, table: string): Promise<IndexInfo[]> {
    const idxs = this.conn.prepare(SQL.indexList(schema, table)).all() as Row[]
    return idxs.map((idx) => {
      const name = String(idx.name)
      const columns = (this.conn.prepare(SQL.indexInfo(schema, name)).all() as Row[]).map((r) =>
        String(r.name)
      )
      return { name, columns, unique: Number(idx.unique) === 1 }
    })
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    const info = this.conn.prepare(sql).run()
    const command = (sql.trim().split(/\s+/)[0] ?? '').toUpperCase()
    return { command, rowCount: info.changes, fields: [], rows: [] }
  }

  async openQuery(sql: string, _pageSize: number): Promise<OpenQueryResult> {
    const stmt = this.conn.prepare(sql).raw(true)
    const fields: FieldInfo[] = stmt.columns().map((c) => ({ name: c.name }))
    const id = `c${this.nextCursor++}`
    this.cursors.set(id, { iter: stmt.iterate() as Iterator<unknown[]>, fields })
    return { queryId: id, fields }
  }
  async fetchPage(queryId: string): Promise<Page> {
    const cur = this.cursors.get(queryId)
    if (!cur) throw new Error(`Unknown query: ${queryId}`)
    // pageSize comes from the QueryResultSource on the renderer side; here we
    // drain in the same size it opened with by reading until the source asks
    // again. better-sqlite3 has no page size on iterate(), so we page by the
    // caller's cadence: read one page worth per fetch using the stored size.
    const rows: unknown[][] = []
    const target = PAGE
    let next = cur.iter.next()
    while (!next.done && rows.length < target) {
      rows.push(next.value)
      if (rows.length < target) next = cur.iter.next()
    }
    const done = !!next.done
    if (done) this.cursors.delete(queryId)
    return { rows, done }
  }
  async closeQuery(queryId: string): Promise<void> {
    const cur = this.cursors.get(queryId)
    cur?.iter.return?.(undefined)
    this.cursors.delete(queryId)
  }
  async cancel(): Promise<void> {
    // No-op: better-sqlite3 is synchronous and local; a running statement
    // completes on the db-host thread before a cancel could be delivered.
  }
}

const PAGE = 1000
```

Note on paging: the renderer's `QueryResultSource` requests fixed-size pages via `fetchPage`; `PAGE = 1000` matches the workbench `PAGE_SIZE`. If a future need requires the exact `pageSize` from `openQuery`, store it per-cursor — out of scope here.
**libsql fallback:** if Task 1 chose libsql, replace `better-sqlite3` usage with `@libsql/client`'s async `client.execute(sql)` → `{ columns, rows }`; `.all()` becomes `await client.execute(...)`.rows; iterate() has no direct equal so page by `LIMIT/OFFSET` or buffer all rows then slice. Keep the same method shapes.

- [ ] **Step 3: The SQLite fixture builder**

`tests/contract/sqlite-fixture.ts`:

```ts
import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Builds a temp SQLite file whose 'app' schema (attached) matches the shared
// contract fixture: users(id pk, email unique not-null, name null, created_at
// default), orders(id pk, user_id fk→users), view user_emails, index
// orders_user_id_idx. Returns the app-db file path.
export function buildSqliteFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fordb-sqlite-'))
  const appFile = join(dir, 'app.sqlite')
  const db = new Database(appFile)
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id)
    );
    CREATE INDEX orders_user_id_idx ON orders(user_id);
    CREATE VIEW user_emails AS SELECT id, email FROM users;
    INSERT INTO users (email, name) VALUES ('a@x.com', 'A'), ('b@x.com', NULL);
    INSERT INTO orders (user_id) VALUES (1), (1), (2);
  `)
  db.close()
  return appFile
}
```

- [ ] **Step 4: SQLite contract test (attach fixture as `app`)**

`tests/contract/sqlite.contract.test.ts`:

```ts
import { beforeAll, afterAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { runAdapterContractTests } from './adapter-contract'
import { SqliteAdapter } from '../../src/db-host/sqlite/sqlite-adapter'
import { buildSqliteFixture } from './sqlite-fixture'
import type { SqliteProfile } from '../../src/shared/adapter/types'

// The adapter connects to a 'main' file that ATTACHes the fixture as 'app', so
// listSchemas() yields ['main','app'] and the shared contract's schema='app'
// assertions hold.
const mainFile = join(mkdtempSync(join(tmpdir(), 'fordb-sqlite-main-')), 'main.sqlite')
const appFile = buildSqliteFixture()

beforeAll(() => {
  const db = new Database(mainFile)
  db.exec(`ATTACH DATABASE '${appFile.replace(/'/g, "''")}' AS app`)
  db.close()
})

const profile: SqliteProfile = {
  id: 's',
  name: 'sqlite-contract',
  engine: 'sqlite',
  file: mainFile
}

// SqliteAdapter opens `mainFile`; make it re-ATTACH `app` on connect by pointing
// the fixture into main via a wrapper adapter factory that attaches after open.
class AttachingSqliteAdapter extends SqliteAdapter {
  async connect(p: typeof profile): Promise<void> {
    await super.connect(p)
    // @ts-expect-error access the protected conn for the test-only attach
    this['conn'].exec(`ATTACH DATABASE '${appFile.replace(/'/g, "''")}' AS app`)
  }
}

runAdapterContractTests(() => new AttachingSqliteAdapter(), profile, {
  database: 'main',
  schema: 'app'
})
```

Note: the ATTACH-on-connect is done via a test-only subclass so the production `SqliteAdapter` stays attach-agnostic (real users open a single file whose tables live in `main`). If subclassing the protected `conn` is awkward, instead make the fixture create BOTH the `app` tables inside `mainFile` directly (single-file, `expected.schema = 'main'`) — simpler, but then it exercises `main` not an attached schema. Prefer the single-file `main` variant if the subclass fights the types: build the fixture tables directly in `mainFile` and pass `{ database: 'main', schema: 'main' }`.

- [ ] **Step 5: Verify + commit**

Run: `pnpm test:contract` (no Docker needed for the SQLite file test; Postgres tests need `pnpm db:up`). Run the full contract: `pnpm db:up && pnpm test:contract && pnpm db:down` — Postgres (28) + SQLite (11) green. Then `pnpm typecheck && pnpm lint`.

```bash
git add src/db-host/sqlite/ tests/contract/sqlite-fixture.ts tests/contract/sqlite.contract.test.ts
git commit -m "feat: SqliteAdapter + SQL + fixture + capability contract test"
```

---

### Task 5: adapterForEngine factory + engine dispatch

**Files:**

- Create: `src/db-host/adapter-factory.ts`, `tests/unit/adapter-factory.test.ts`
- Modify: `src/db-host/connection-registry.ts`, `src/db-host/host-api-impl.ts`, `src/db-host/index.ts`

**Interfaces:**

- Consumes: `PostgresAdapter`, `SqliteAdapter`, `ConnectionProfile['engine']`.
- Produces: `adapterForEngine(engine: ConnectionProfile['engine']): DbAdapter`.

- [ ] **Step 1: Factory + test**

`src/db-host/adapter-factory.ts`:

```ts
import type { DbAdapter } from '@shared/adapter/db-adapter'
import type { ConnectionProfile } from '@shared/adapter/types'
import { PostgresAdapter } from './postgres/postgres-adapter'
import { SqliteAdapter } from './sqlite/sqlite-adapter'

export function adapterForEngine(engine: ConnectionProfile['engine']): DbAdapter {
  switch (engine) {
    case 'postgres':
      return new PostgresAdapter()
    case 'sqlite':
      return new SqliteAdapter()
  }
}
```

`tests/unit/adapter-factory.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { adapterForEngine } from '../../src/db-host/adapter-factory'
import { PostgresAdapter } from '../../src/db-host/postgres/postgres-adapter'
import { SqliteAdapter } from '../../src/db-host/sqlite/sqlite-adapter'

describe('adapterForEngine', () => {
  it('returns a PostgresAdapter for postgres', () => {
    expect(adapterForEngine('postgres')).toBeInstanceOf(PostgresAdapter)
  })
  it('returns a SqliteAdapter for sqlite', () => {
    expect(adapterForEngine('sqlite')).toBeInstanceOf(SqliteAdapter)
  })
})
```

- [ ] **Step 2: Registry + host-api-impl + db-host use the factory**

- `src/db-host/index.ts` — the registry is constructed with `() => new PostgresAdapter()`. Change to `(engine) => adapterForEngine(engine)` and import `adapterForEngine`.
- `src/db-host/connection-registry.ts` — confirm the `makeAdapter` field type is `(engine: ConnectionProfile['engine']) => DbAdapter` (bumped in Task 2 Step 8) and `open()` calls `connectAdapter((e) => this.makeAdapter(e), profile)` — thread the engine through (Task 2 made `connectAdapter` take `(engine) => DbAdapter`).
- `src/db-host/host-api-impl.ts` — `testConnection` replaces the Task-2 stub with `connectAdapter((engine) => adapterForEngine(engine), profile)`; import `adapterForEngine`, drop the direct `PostgresAdapter` import if now unused.

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test` (adapter-factory 2 new). `pnpm db:up && pnpm test:contract && pnpm db:down` (unchanged counts). `pnpm build`.

```bash
git add src/db-host/adapter-factory.ts src/db-host/connection-registry.ts src/db-host/host-api-impl.ts src/db-host/index.ts tests/unit/adapter-factory.test.ts
git commit -m "feat: adapterForEngine factory + engine dispatch"
```

---

### Task 6: Native file-picker IPC

**Files:**

- Modify: `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/rpc.ts`

**Interfaces:**

- Produces: `window.fordb.dialog.openFile(): Promise<string | null>`.

- [ ] **Step 1: Main handler**

Modify `src/main/ipc.ts` — import `dialog` from electron; register:

```ts
ipcMain.handle('dialog:open-file', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'SQLite', extensions: ['sqlite', 'db', 'sqlite3'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
})
```

- [ ] **Step 2: Preload**

Modify `src/preload/index.ts` — add to the `fordb` object:

```ts
  dialog: {
    openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:open-file')
  },
```

- [ ] **Step 3: Renderer type**

Modify `src/renderer/src/rpc.ts` — add to the `Window.fordb` declaration:

```ts
dialog: {
  openFile: () => Promise<string | null>
}
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/src/rpc.ts
git commit -m "feat: native open-file dialog IPC for SQLite file selection"
```

---

### Task 7: ProfileForm engine selector + file/Browse

**Files:**

- Modify: `src/renderer/src/components/ProfileForm.tsx`

**Interfaces:**

- Consumes: `window.fordb.dialog.openFile` (Task 6), `SqliteProfile`/`PostgresProfile` (Task 2).

- [ ] **Step 1: Engine state + selector**

Modify `src/renderer/src/components/ProfileForm.tsx`:

- Add `const [engine, setEngine] = useState<'postgres' | 'sqlite'>(p?.engine ?? 'postgres')` and `const [file, setFile] = useState(p?.engine === 'sqlite' ? p.file : '')`.
- Render a `Select` (reusing `./ui/select`) at the top: options Postgres / SQLite, bound to `engine`.
- Wrap the URL-paste block and all host/port/user/password/SSL/SSH fields in `{engine === 'postgres' && ( … )}`.
- Add a SQLite block `{engine === 'sqlite' && ( … )}` with a file `Input` (value `file`) + a `Browse…` `Button` whose onClick does `const f = await window.fordb.dialog.openFile(); if (f) setFile(f)`.

- [ ] **Step 2: build() returns the right variant**

Replace `build()` so it returns a `SqliteProfile` when `engine === 'sqlite'`:

```ts
function build(): ConnectionProfile {
  const base = { id: p?.id ?? newId(), name }
  if (engine === 'sqlite') {
    const sqlite = { ...base, engine: 'sqlite' as const, file }
    return { ...sqlite, name: name.trim() || connectionLabel(sqlite) }
  }
  // …existing postgres construction, with engine: 'postgres' as const…
}
```

`secrets()` returns `{}` for SQLite (no secret fields). The `test()`/`save()` flows are unchanged (they already go through `window.fordb.profiles.save(build(), secrets())`).

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Headless dev smoke optional (dialog needs desktop).

```bash
git add src/renderer/src/components/ProfileForm.tsx
git commit -m "feat: engine selector + SQLite file picker in ProfileForm"
```

---

### Task 8: Hide the Dashboard tab for engines without server stats

**Files:**

- Modify: `src/renderer/src/query/stats.ts`, `src/renderer/src/App.tsx`

**Interfaces:**

- Consumes: `HostApi.serverStatsSupported` (already exists), `qk` keys.
- Produces: `useServerStatsSupported(connId): UseQueryResult<boolean>`.

- [ ] **Step 1: The hook**

Modify `src/renderer/src/query/stats.ts` — add:

```ts
export function useServerStatsSupported(connId: string | null): UseQueryResult<boolean> {
  return useQuery({
    queryKey: connId
      ? (['conn', connId, 'statsSupported'] as const)
      : ['conn', 'none', 'statsSupported'],
    queryFn: async () => (await hostApi()).serverStatsSupported(connId!),
    enabled: !!connId
  })
}
```

- [ ] **Step 2: App hides the tab + falls back**

Modify `src/renderer/src/App.tsx`:

- `const statsSupported = useServerStatsSupported(activeConnectionId).data ?? false` (import the hook).
- Render the **Dashboard** toggle button only when `statsSupported`.
- Guard the body: `{mainView === 'dashboard' && statsSupported ? <ServerDashboard /> : <QueryWorkbench />}` — so a connection without stats (SQLite) always shows the workbench even if `mainView` was left on `dashboard` from a previous Postgres connection.

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

```bash
git add src/renderer/src/query/stats.ts src/renderer/src/App.tsx
git commit -m "feat: hide Dashboard tab when the engine has no server stats"
```

---

### Task 9: SQLite e2e (headless)

**Files:**

- Create: `tests/e2e/sqlite.spec.ts`

**Interfaces:**

- Consumes: the running app; a temp seeded SQLite file.

- [ ] **Step 1: The e2e**

`tests/e2e/sqlite.spec.ts` — build a temp SQLite file in the test, then drive the form. Because Playwright can't operate the OS file dialog, type the path into the file input directly (the input is a normal text field):

```ts
import { test, expect, _electron as electron } from '@playwright/test'
import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('create a sqlite connection, browse, run a query', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-e2e-')), 'e2e.sqlite')
  const db = new Database(file)
  db.exec(
    `CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO widgets (label) VALUES ('x'), ('y')`
  )
  db.close()

  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByRole('combobox').selectOption('sqlite') // engine selector
  await win.getByPlaceholder('Name', { exact: true }).fill('e2e-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Save').click()
  await win.getByText('e2e-sqlite').click()

  await expect(win.getByText('widgets')).toBeVisible({ timeout: 15000 }) // schema tree node
  await win.locator('.cm-content').click()
  await win.keyboard.type('SELECT id, label FROM widgets ORDER BY id')
  await win.getByText('Run', { exact: true }).click()
  await expect(win.getByText(/rows/)).toBeVisible({ timeout: 15000 })

  await app.close()
})
```

Adjust the engine-selector locator to match ProfileForm's actual `Select` markup (the shadcn `Select` may not be a native `<select>` — if so, click the trigger and the "SQLite" item instead of `selectOption`). Give the SQLite file `Input` a `placeholder="File"` in Task 7 so this locator resolves.

- [ ] **Step 2: Run it**

Run: `pnpm build && pnpm e2e tests/e2e/sqlite.spec.ts`. This one needs NO keychain (SQLite has no secrets), so it runs fully headless. Expected: green. If the shadcn Select isn't a native combobox, update the locator per the note.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/sqlite.spec.ts
git commit -m "test: sqlite e2e — create connection, browse, run a query"
```

---

## Self-Review (done at plan time)

1. **Spec coverage:** Union (spec §1) → Task 2. Engine dispatch (§2) → Task 5 (+ Task 2 stub). SqliteAdapter (§3) → Task 4. serverStats degradation (§4) → Task 8. File picker (§5) → Tasks 6–7. Contract parameterization (§6) → Task 3, SQLite contract → Task 4. Build/ABI (§7) → Task 1. Testing (§8): spike+smoke (1), contract (3,4), unit (2,5), e2e (9). Success criterion (create → browse → query → autocomplete, Dashboard hidden, contract passes) covered by Tasks 4/7/8/9.
2. **Placeholder scan:** No TBD/TODO. Every code step carries full code. The two deliberate flex points — the SQLite contract's attach-vs-single-file approach (Task 4 Step 4) and the shadcn-Select e2e locator (Task 9 Step 1) — are acceptance-defined with a concrete fallback each, because the exact form-control markup and the attach-subclass typing can vary; the adapter contract and the `expected` values are pinned.
3. **Type consistency:** `PostgresProfile`/`SqliteProfile`/`ConnectionProfile` (Task 2) used verbatim in Tasks 4/5/7. `adapterForEngine(engine)` (Task 5) matches the `makeAdapter(engine)` signature bumped in Task 2 and consumed by the registry/connect-with-tunnel. `runAdapterContractTests(make, profile, expected)` (Task 3) matches both callers (Tasks 3, 4). `SqliteAdapter` method shapes match `DbAdapter`. `useServerStatsSupported` (Task 8) matches the existing `serverStatsSupported` HostApi method (server-stats milestone). `window.fordb.dialog.openFile` (Task 6) matches its ProfileForm caller (Task 7) and e2e.

**Known deliberate deferrals:** exact `pageSize` from `openQuery` not threaded into `fetchPage` (fixed `PAGE=1000` matching the workbench); `cancel()` no-op for SQLite (sync/local); the driver may flip to libsql at Task 1 (adapter shape unchanged, async API noted in Task 4); the SQLite contract may exercise `main` instead of an attached `app` schema if the attach-subclass typing fights (both satisfy the contract via `expected`).

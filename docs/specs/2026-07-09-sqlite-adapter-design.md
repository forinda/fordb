# fordb — SQLite Engine Adapter: Design Spec

Status: Approved 2026-07-09 · Milestone: M-SQLite (after M-ServerStats) · References: `DbAdapter` contract, `ConnectionRegistry`, M2 connection manager, M-ServerStats capability pattern.

The second engine. A `SqliteAdapter` implementing the full `DbAdapter` contract (browse schema, run queries, cursor-stream results), addressed by a file-path profile, registered by engine, with the server-stats dashboard degrading cleanly (SQLite has no `pg_stat` equivalent).

## Goal / exit criterion

A user can create a SQLite connection (pick a `.sqlite`/`.db` file via a native picker), connect, browse its tables/columns/keys/indexes in the schema tree, run queries with streamed results, and use autocomplete — the same workbench experience as Postgres. The Dashboard tab is hidden for SQLite. `runAdapterContractTests` passes for SQLite. No Postgres regression.

## Non-goals (v1)

- No server-stats for SQLite (no cluster/session concept). The capability is simply omitted.
- No remote SQLite (Turso/libsql remote URLs) — local files only. (libsql remote is a possible later add if the driver becomes libsql.)
- No SQLite-specific niceties (ATTACH management UI, PRAGMA editor, VACUUM button) — just the standard adapter surface.
- No write-safety guardrails beyond what Postgres has (queries can mutate the file, same as PG).

## Decisions locked during design

- Driver: **better-sqlite3** (sync, wrapped in the async `DbAdapter`). **Fallback:** if the Task-1 ABI spike proves too painful, auto-switch to `@libsql/client` (N-API prebuilt) — same `SqliteAdapter` shape — and report.
- Profile: a **discriminated union** by engine (`PostgresProfile | SqliteProfile`).
- File selection: **native Electron open-file dialog** via a new main IPC.
- Schema model: `DbAdapter`'s "schema" maps to SQLite's **attached-database name** (`PRAGMA database_list`).
- serverStats: omitted; the renderer hides the Dashboard tab when `serverStatsSupported` is false.

## 1. Profile as a discriminated union (`src/shared/adapter/types.ts`)

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
  // SECRETS — transient, never persisted; stripped in ProfileStore.save().
  password?: string
  sshPassword?: string
  sshPassphrase?: string
  ssl?: SslOptions
  ssh?: SshOptions
}
export interface SqliteProfile extends BaseProfile {
  engine: 'sqlite'
  file: string // absolute path to the .sqlite/.db file
}
export type ConnectionProfile = PostgresProfile | SqliteProfile
```

Consumers narrow on `.engine`:

- `connectionLabel` (`src/shared/connection-label.ts`): SQLite → `name || basename(file)`; Postgres → unchanged (`name || user@host/database`).
- `ProfileStore.save()` (`src/main/profile-store.ts`): the secret-strip stays Postgres-only. SQLite has no secret fields — structurally secretless (strengthens the "no secrets in profiles.json" invariant). A `switch (profile.engine)` makes omission explicit.
- `parseConnectionUrl` / URL-import stays Postgres-only (SQLite has no DSN). The URL-paste box is hidden for the SQLite engine.

## 2. Engine dispatch (`src/db-host/adapter-factory.ts`)

New: `adapterForEngine(engine: ConnectionProfile['engine']): DbAdapter` returning `new PostgresAdapter()` or `new SqliteAdapter()`. Used by:

- `ConnectionRegistry` — its `makeAdapter` constructor param changes from `() => DbAdapter` to `(engine) => DbAdapter`; `open(profile)` calls `this.makeAdapter(profile.engine)`.
- `HostApiImpl.testConnection` — uses `adapterForEngine(profile.engine)` instead of `() => new PostgresAdapter()`.

`connectAdapter` (`connect-with-tunnel.ts`) already opens a tunnel only when `profile.ssh` is set; SQLite profiles have no `ssh`, so the tunnel path is skipped unchanged. Its `makeAdapter` param is likewise threaded the engine.

## 3. SqliteAdapter (`src/db-host/sqlite/sqlite-adapter.ts`)

Wraps better-sqlite3 (synchronous) behind the async contract. Schema = attached-database name.

- `connect(profile)` — `this.db = new Database(profile.file)` (throws if the file is unopenable). `disconnect()` — `this.db.close()`.
- `listDatabases()` — `PRAGMA database_list` → the `name` column (`main`, `temp`, attached names).
- `listSchemas()` — same set (SQLite's namespaces are its attached databases). Returns `['main', …]`.
- `listTables(schema)` — `SELECT name, type FROM "<schema>".sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name` → `TableInfo{schema,name,type}`.
- `getColumns(schema, table)` — `PRAGMA "<schema>".table_info(<table>)` → `ColumnInfo{ name, dataType: type, nullable: notnull === 0, defaultValue: dflt_value, ordinal: cid + 1 }`.
- `getKeys(schema, table)` — primary: table_info rows with `pk > 0` (ordered by pk) → one `KeyInfo{kind:'primary'}`; foreign: `PRAGMA foreign_key_list(<table>)` grouped by `id` → `KeyInfo{kind:'foreign', columns, referencedTable: table}`; unique: `PRAGMA index_list(<table>)` rows with `unique=1 AND origin='u'`, columns from `index_info` → `KeyInfo{kind:'unique'}`.
- `getIndexes(schema, table)` — `PRAGMA index_list(<table>)` + `PRAGMA index_info` per index → `IndexInfo{ name, columns, unique }`.
- `executeQuery(sql)` — `const info = this.db.prepare(sql).run()` → `QueryResult{ command: firstWord(sql).toUpperCase(), rowCount: info.changes, fields: [], rows: [] }`. (`isSelectLike` routes SELECTs to `openQuery`, so `executeQuery` only sees non-SELECT.)
- `openQuery(sql, pageSize)` — `const stmt = this.db.prepare(sql); stmt.raw(true)` (array rows); `const fields = stmt.columns().map(c => ({ name: c.name }))`; hold `stmt.iterate()` in a `Map<queryId, Iterator>`; return `OpenQueryResult{ queryId, fields }`.
- `fetchPage(queryId)` — pull up to `pageSize` rows from the stored iterator → `Page{ rows, done }` (done when the iterator is exhausted). Cleans up the iterator on done.
- `closeQuery(queryId)` — drop the iterator (calling its `.return?.()`), delete from the map.
- `cancel()` — no-op resolve. better-sqlite3 is synchronous and local; a running statement blocks the db-host thread and completes before `cancel` could be delivered. Documented limitation (matches the reality; the M-ServerStats deferral list already notes cancel is engine-specific).

Column/table identifiers are interpolated into PRAGMA/`sqlite_master` queries where bind parameters aren't accepted; they are quoted (`"…"`) and, for defense, validated against SQLite's own catalog (only names returned by `listSchemas`/`listTables` are ever passed by the app). PRAGMA functions (`table_info`, `foreign_key_list`, `index_list`, `index_info`) accept the name as a function argument.

## 4. serverStats degradation (renderer)

- SqliteAdapter does **not** implement `serverStats` → `HostApiImpl.serverStatsSupported(id)` returns `false`.
- New renderer hook `useServerStatsSupported(connId)` (`src/renderer/src/query/stats.ts`) — a one-shot `useQuery` (no `refetchInterval`), key `['conn', connId, 'statsSupported']`.
- `App.tsx` — the `[Query | Dashboard]` switch renders the **Dashboard** button only when supported; if the active mode is `dashboard` on an unsupported connection, fall back to `query`. So SQLite shows just the Query workbench, no error-spamming dashboard. (This wires the previously-unused `serverStatsSupported` method — closes a M-ServerStats deferral.)

## 5. Native file picker

- Main (`src/main/ipc.ts`): `ipcMain.handle('dialog:open-file', …)` → `dialog.showOpenDialog({ properties:['openFile'], filters:[{name:'SQLite', extensions:['sqlite','db','sqlite3']},{name:'All', extensions:['*']}] })` → returns the first path or `null` on cancel.
- Preload (`src/preload/index.ts`): `window.fordb.dialog.openFile(): Promise<string | null>`.
- `ProfileForm`: an **engine selector** (Postgres | SQLite). SQLite → a file-path field + **Browse…** button (calls `openFile`), and hides host/port/user/password/SSL/SSH/URL-paste. Postgres → the current form. `build()` returns the right variant per engine.

## 6. Contract-suite parameterization

`runAdapterContractTests(makeAdapter, profile, expected)` gains `expected: { database: string; schema: string }`. The assertions use `expected.database`/`expected.schema` instead of the literals `profile.database`/`'app'`. Callers:

- Postgres (`postgres.contract.test.ts`): `expected = { database: 'fordb_test', schema: 'app' }` — behavior identical to today.
- SQLite (`sqlite.contract.test.ts`, NEW): a `beforeAll` builds a temp SQLite fixture file (users/orders/view/FK/index matching the shared fixture's shape), the adapter connects to it and `ATTACH`es it (or a second file) **as `app`** so `listSchemas` includes `app`; `expected = { database: 'main', schema: 'app' }`.

The shared assertions (ordinal sequence, `nullable`, `defaultValue` truthy, primary/unique/foreign keys, index columns) are dialect-neutral; the SQLite fixture is crafted so its `table_info`/`index_list` output satisfies them (e.g. `email TEXT NOT NULL UNIQUE`, `name TEXT`, `created_at … DEFAULT CURRENT_TIMESTAMP`, `orders.user_id` FK → `users`, non-unique index `orders_user_id_idx`).

## 7. Build / packaging (better-sqlite3)

- Mark `better-sqlite3` **external** in the db-host/main Rollup build (`electron.vite.config.ts`), same pattern as `pg-native`/`cpu-features` — it's a native `require` that must not be bundled.
- Packaging: `electron-builder install-app-deps` (or `@electron/rebuild`) rebuilds better-sqlite3 for Electron's ABI at package time. Documented in CONTRIBUTING.
- **ABI note:** vitest contract tests run on plain Node; the db-host runs on Electron's Node. A single install is ABI-built for one at a time. Task 1 (spike) pins the workflow (e.g. Node-ABI build for `pnpm test`/CI; `install-app-deps` before `pnpm dev`/package). If unworkable, fall back to `@libsql/client` (N-API — one binary works in both).

## 8. Testing

- **Task-1 spike gate:** a throwaway script that `require`s better-sqlite3 and runs `SELECT 1` under BOTH the db-host utilityProcess (Electron) and vitest (Node). Green → proceed with better-sqlite3; red → switch to libsql (per the locked fallback) and note it.
- **Contract:** `sqlite.contract.test.ts` runs the full `runAdapterContractTests` against a temp fixture. Postgres contract unchanged (behaviorally).
- **Unit:** `adapterForEngine` returns the right class per engine; `connectionLabel` for a SQLite profile → basename; `ProfileStore.save()` persists a SQLite profile unchanged (nothing to strip) and still strips Postgres secrets; profile discriminated-union type-narrowing compiles.
- **e2e:** create a SQLite connection pointing at a seeded temp file → connect → schema tree shows a table → run a query → rows. (Native dialog is stubbed/bypassed by typing the path, since Playwright can't drive the OS file dialog.) The connect step needs no keychain (SQLite has no secrets) — so unlike the Postgres e2e, this one can run fully headless.
- Existing unit + contract + the Postgres e2e stay green.

## 9. File structure

```
src/shared/adapter/types.ts                 # MODIFY: ConnectionProfile → union
src/shared/connection-label.ts              # MODIFY: SQLite basename label
src/db-host/adapter-factory.ts              # NEW: adapterForEngine(engine)
src/db-host/connection-registry.ts          # MODIFY: makeAdapter(engine)
src/db-host/connect-with-tunnel.ts          # MODIFY: thread engine to makeAdapter
src/db-host/host-api-impl.ts                # MODIFY: testConnection via adapterForEngine
src/db-host/sqlite/sqlite-adapter.ts        # NEW: SqliteAdapter
src/db-host/sqlite/sqlite-sql.ts            # NEW: PRAGMA/sqlite_master query strings
src/main/profile-store.ts                   # MODIFY: engine-switched secret strip
src/main/ipc.ts                             # MODIFY: dialog:open-file handler
src/preload/index.ts                        # MODIFY: window.fordb.dialog.openFile
src/renderer/src/rpc.ts                     # MODIFY: dialog type in Window.fordb
src/renderer/src/query/stats.ts             # MODIFY: useServerStatsSupported
src/renderer/src/components/ProfileForm.tsx # MODIFY: engine selector + file/Browse
src/renderer/src/App.tsx                    # MODIFY: hide Dashboard tab when unsupported
electron.vite.config.ts                     # MODIFY: better-sqlite3 external
tests/contract/adapter-contract.ts          # MODIFY: expected {database,schema} param
tests/contract/postgres.contract.test.ts    # MODIFY: pass expected
tests/contract/sqlite.contract.test.ts      # NEW
tests/contract/sqlite-fixture.ts            # NEW: builds the temp SQLite fixture
tests/unit/adapter-factory.test.ts          # NEW
tests/e2e/sqlite.spec.ts                    # NEW
```

## 10. Risks

| Risk                                                       | Mitigation                                                                                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| better-sqlite3 ABI split (Node tests vs Electron app)      | Task-1 spike pins the workflow; libsql fallback (N-API) if unworkable                                                                                       |
| Discriminated-union migration breaks merged consumers      | Grep every `.host`/`.database`/`.user`/`profile.password` use; narrow on `.engine`; the type change makes missed sites compile-fail (that's the safety net) |
| SQLite "schema" semantics differ from PG                   | Map schema→attached-db name; contract parameterized with `expected` so it's engine-neutral; fixture attached as `app`                                       |
| PRAGMA needs identifier interpolation (no bind params)     | Only names from the catalog (`listSchemas`/`listTables`) are passed; quote identifiers; PRAGMA-function form takes the name as an argument                  |
| `cancel()` can't interrupt a sync better-sqlite3 statement | No-op documented; SQLite statements are local/fast; revisit if long analytical queries become a use case                                                    |

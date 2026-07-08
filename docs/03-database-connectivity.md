# 03 — Database Connectivity Layer

Question: drivers for PostgreSQL / SQLite / MongoDB in TypeScript, pluggable adapter architecture, SSH/SSL, and where drivers live in Electron vs Tauri. (Versions verified against npm registry 2026-07-08.)

## PostgreSQL — pick `pg` (node-postgres)

| | `pg` 8.22 | `postgres` (postgres.js) 3.4.9 |
|---|---|---|
| Maturity | De facto standard; monorepo with pg-pool/pg-cursor/pg-query-stream | Alive but single-maintainer; open issues on error typing, occasional hangs ([#1132](https://github.com/porsager/postgres/issues/1132), [#1089](https://github.com/porsager/postgres/issues/1089)) |
| API for arbitrary user SQL | `client.query(text, values)` — natural fit for a GUI | Tagged templates; arbitrary strings need `sql.unsafe()` escape hatch |
| Streaming | pg-cursor `cursor.read(n)` + pg-query-stream (server-side cursor, low memory) | `.cursor(n, cb)` + async iteration |
| Cancellation | No built-in — standard GUI pattern: capture `pg_backend_pid()` at connect, run `SELECT pg_cancel_backend($pid)` from a side connection (~30 lines) ([#773](https://github.com/brianc/node-postgres/issues/773)) | Built-in `query.cancel()` |
| Performance | Comparable once prepared statements configured; not the bottleneck in a GUI (rendering is) | Faster out of box (caches prepared statements) |

Verdict: **`pg`** — string-query API, mature cursor ecosystem, used by both Beekeeper Studio and DbGate. Cancel workaround is well-trodden.

## SQLite — pick `better-sqlite3`, design for `node:sqlite` swap

- **better-sqlite3 12.11**: fastest, synchronous API (use worker thread for big queries), prebuilt binaries for Node — but **Electron ABI rebuild tax is real and permanent**: `@electron/rebuild` postinstall + electron-builder `npmRebuild: true` + `asarUnpack` for the `.node` binary. ([repo](https://github.com/WiseLibs/better-sqlite3), [Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules))
- **node:sqlite** (Node 22.5+, no flag since Node 24, still stability "release candidate"): API modeled on better-sqlite3, zero rebuild pain, slightly slower. Electron availability depends on bundled Node (22.9+ in Electron 35) and has had flag issues ([electron#45532](https://github.com/electron/electron/issues/45532)).
- **@libsql/client 0.17**: only worth it if remote Turso/libsql-server support becomes a feature; local mode is async-only.

Verdict: **better-sqlite3 now; adapter interface async from day one so node:sqlite can replace it when stable in our Electron.**

## MongoDB — official `mongodb` driver 7.5

No decision needed. v7 (Nov 2025): min Node 20.19, pool idle-cleanup fixes, lazy cursor sessions. Everything a GUI needs:
- `client.db().admin().listDatabases()` → database tree
- `db.listCollections({}, { nameOnly: true })` → fast collection list
- `find()` / `aggregate()` return batched cursors with async iteration → streaming story for the grid
- Cancel: `cursor.close()` / `killOp`-style admin command

## Pluggable adapter architecture

Three verified reference implementations:

1. **Beekeeper Studio** — the strongest reference for our stack:
   - `IBasicDatabaseClient` interface → abstract `BasicDatabaseClient` (shared logic) → engine subclasses (`PostgresClient`, …).
   - Drivers run in an **Electron utility process** ("acts like a server… has all native node modules within it"); each renderer window gets a `MessageChannel`; renderer-side `ElectronUtilityConnectionClient` implements the **same interface over IPC** — UI code doesn't know it's remote. ([Utility Process wiki](https://github.com/beekeeper-studio/beekeeper-studio/wiki/Utility-Process))
2. **Sqlectron** (sqlectron-db-core) — simpler: `createServer(config)` → `createConnection(db)` → `db.executeQuery(sql)`; SSH tunnel config lives in *server* config, not the driver (good pattern). ([repo](https://github.com/sqlectron/sqlectron-db-core))
3. **DbGate** — most decoupled: each engine a standalone npm plugin (`dbgate-plugin-postgres`) split into frontend driver (connection-form fields) + backend driver (query) + `Analyser` (schema introspection). Copy this if third-party engine plugins ever become a goal. ([plugin docs](https://docs.dbgate.io/plugin-development/))

Common interface shape across all three — our adapter contract:
`connect/disconnect · listDatabases · listTables/Views/Routines · getTableColumns/Keys/Indexes · executeQuery → {rows, fields, rowCount, command}` per statement · streaming variant for large results · pagination helpers.

**Key architectural takeaway: define the adapter as an async, serializable RPC contract from day one** (Beekeeper's same-interface-both-sides-of-IPC trick). Makes the process boundary — and even the shell choice — swappable.

## SSH tunneling, TLS, pooling

- **SSH**: `ssh2` 1.17 base; `tunnel-ssh` 5.2 wrapper (`createTunnel()` → local port → point driver at `127.0.0.1:<port>`). Local-listener pattern works for every driver incl. MongoDB; direct `forwardOut()` stream injection possible for pg/mysql2 but per-driver. Support password / private key + passphrase / SSH agent (sqlectron models exactly this). One tunnel per connection tab, torn down with the connection.
- **TLS**: expose CA file, client cert/key, "trust server certificate" toggle — maps cleanly onto all three drivers (`pg` ssl = tls.connect options; postgres.js `ssl: 'require' | {rejectUnauthorized}`; mongodb `tls=true` + `tlsCAFile` / `tlsCertificateKeyFile` / `tlsAllowInvalid*`).
- **Pooling**: desktop ≠ server. Model: **1 long-lived connection per query tab + 1 utility connection per server** (cancellation + introspection). `pg`: single Client or pool `max: 2`; postgres.js defaults `max: 10` — tune down; MongoClient pools internally. Set `query_timeout`/`statement_timeout` and `connectTimeoutMS` per connection profile.

## Where drivers live

**Electron** (chosen shell, per doc 01):
- Never the renderer (`nodeIntegration` off, contextBridge only).
- Main process works but heavy queries jank window management.
- **Recommended: dedicated `utilityProcess`** hosting all drivers + native modules — Beekeeper's production answer.
- Only better-sqlite3 triggers rebuild pain; `pg` and `mongodb` are pure JS.

**Tauri** (for the record): no Node runtime → npm drivers can't run. Options are Rust-side drivers (official tauri-plugin-sql wraps sqlx: SQLite/MySQL/Postgres; MongoDB via Rust crate + custom commands) or a bundled Node sidecar (~40–80MB binary + own RPC — negates Tauri's size win). Confirms doc 01's Electron recommendation: the TypeScript driver layer is the core asset, and Electron is its path of least resistance.

## Package shortlist

| Purpose | Package | Version (2026-07-08) |
|---|---|---|
| PostgreSQL | pg (+ pg-cursor, pg-query-stream) | 8.22.0 / 2.21.0 / 4.16.0 |
| SQLite | better-sqlite3 | 12.11.1 |
| MongoDB | mongodb | 7.5.0 |
| SSH | ssh2 + tunnel-ssh | 1.17.0 / 5.2.0 |

Full source list in the research agent report (node-postgres docs, driver issues, Beekeeper wiki, DbGate plugin docs, Tauri plugin docs).

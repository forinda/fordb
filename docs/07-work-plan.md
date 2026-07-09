# fordb — Work Plan

Milestones ordered by dependency. Each milestone ships something runnable. Stories to be broken out per milestone when it starts (M1 first).

## Status (2026-07-09)

Shipped, roughly in order — the build diverged from the original M0–M8 numbering as features were pulled forward:

- **M0–M4 done** — toolchain, `DbAdapter` contract + `runAdapterContractTests`, MessagePort RPC, `PostgresAdapter`, connection manager (profiles + `safeStorage` keychain + SSL + SSH tunnel + URL import), schema tree + command palette, SQL editor + Glide results grid + CSV/JSON result export.
- **M-Appearance** — light/dark/system theming (Radix Colors tokens).
- **M-ReactQuery** — introspection + profiles on TanStack Query (shared cache: tree ⇄ autocomplete), lazy per-node tree, refresh + DDL invalidation.
- **M-ServerStats** — read-only Postgres dashboard: session/connection gauges (idle-in-txn flagged), live uPlot charts (TPS, cache hit, tuples/s, connections), sessions table, locks panel. Optional `serverStats` adapter capability.
- **M-SQLite** — second engine on **@libsql/client** (not better-sqlite3 — ABI spike chose N-API prebuilts, no rebuild toggle). Passes the shared contract. Dashboard tab hidden for engines without stats.
- **M-SQLiteRemote** — SQLite as local file **/ remote (Turso/libsql) / embedded replica**; auth token via keychain; remote + replica contract-tested against a `sqld` container.

**Not yet done:** M5 (release pipeline), M7 (MongoDB), M8 (v1.0 signing/hardening), and the **administrator-client roadmap below** — the write-side + management features that make fordb a full DBA tool rather than a browse/query client.

## Cross-cutting rules for the admin roadmap

Every milestone below obeys these, so they're stated once:

- **Capability-gated per engine.** Like `serverStats`, admin features are optional `DbAdapter` capabilities (`DataEditor`, `SchemaEditor`, `ServerAdmin`, …). Postgres implements the most; SQLite a subset (limited `ALTER TABLE`, no users/privileges); MongoDB a different shape. The renderer feature-detects and hides what an engine can't do — never a broken button.
- **Secret-safe unchanged.** All writes go through the existing `executeQuery`/RPC path addressed by `connectionId`; no new secret surface, secrets never in the renderer.
- **Destructive = confirmed + previewed.** Any mutation (row edit, DROP, kill backend) shows the generated SQL and requires explicit confirm; multi-row/DDL runs in a transaction where the engine supports it.
- **Contract-tested.** Each new capability extends `runAdapterContractTests` (capability-gated) so every engine that claims it must prove it.
- **Keyboard-first.** Every control is a command in the palette with a shortcut; forms are the fallback, not the primary path (the anti-Adminer).

## M0 — Repo & toolchain (small)

- git repo, MIT license, README with product one-liner
- pnpm + TypeScript strict + electron-vite scaffold (main / preload / renderer / db-host entry points)
- ESLint + Prettier, vitest, GitHub Actions CI (lint + test on PR)
- **Exit:** `pnpm dev` opens an empty window from the three-process skeleton.

## M1 — Adapter contract + Postgres adapter (core asset)

- Define `DbAdapter` interface + shared types (`QueryResult`, `ColumnInfo`, `ConnectionProfile`)
- MessagePort RPC layer: renderer `AdapterClient` proxy ↔ db-host dispatcher (serialization, errors, cancellation tokens)
- `PostgresAdapter` on pg: connect/disconnect, listDatabases/Schemas/Tables/Views, getColumns/Keys/Indexes, executeQuery, fetchPage via pg-cursor, cancel via `pg_backend_pid` + utility connection
- **Adapter contract test suite** (vitest) against real Postgres in Docker — CI service container; every future engine must pass it
- **Exit:** headless test proves connect → introspect → query → stream pages → cancel.

## M2 — Connection manager

- Profile store: JSON on disk, secrets via `safeStorage` (keychain)
- SSL options (CA / client cert+key / trust toggle) wired to pg config
- SSH tunnel via tunnel-ssh (password / key+passphrase / agent), lifecycle bound to connection
- Connection UI: profile list, create/edit form, test-connection
- **Exit:** connect to local + SSH-tunneled remote Postgres from the UI.

## M3 — Schema tree + command palette shell

- App shell layout: sidebar (tree) + tab area + status bar
- Command registry (every action = command, optional shortcut) + Ctrl+K palette — built NOW, before features accrete
- react-arborist tree, lazy-loaded from adapter introspection
- **Exit:** browse 1k-table schema via keyboard only.

## M4 — SQL editor + results grid

- CodeMirror 6 tabs; lang-sql autocomplete fed from introspection cache
- Run statement/selection/all → streamed into Glide Data Grid (own `ResultsGrid` wrapper component — swap-safe)
- Query cancel (command + button), local query history
- CSV/JSON export of current result
- **Exit:** 500k-row query, responsive grid, no-mouse flow end-to-end. Playwright smoke: connect → query → rows visible.

## M5 — v0.1 release pipeline

- electron-builder config: deb + AppImage (`toolsets.appimage: "1.0.3"`) + NSIS, `asarUnpack` prep
- Release workflow from doc 02: tag → matrix build → GitHub Release + `latest*.yml`; electron-updater wired
- AUR job (`fordb-bin` PKGBUILD template + github-actions-deploy-aur); SHA-256 checksums; winget manifest submitted
- Perf gate in CI: cold start + idle RAM measured, published in README
- **Exit:** `v0.1.0` tag produces installable deb/AppImage/NSIS + AUR package. Success criteria in PRD §8 all pass.

## M6 — v0.2: editing + SQLite

- Row/cell editing in grid → generated SQL preview → apply in transaction
- Table-data browse mode (paginated SELECT without writing SQL)
- `SqliteAdapter` (better-sqlite3 + @electron/rebuild); passes M1 contract suite; file-picker connection profile
- **Exit:** v0.2.0 released, both engines pass shared contract tests.

## M7 — v0.3: MongoDB

- `MongoAdapter` (official driver): listDatabases/Collections, find/aggregate with cursor paging, cancel via cursor close
- Collection browse: filter bar, JSON tree (@uiw/react-json-view) + raw (CM6 JSON) views
- Adapter contract suite variant for document engines
- **Exit:** v0.3.0 — the free-Mongo wedge shipped.

## M8 — v1.0 hardening

- Windows signing (SignPath application → IV cert fallback), macOS build + notarization
- Flathub manifest, auto-update polish, docs site/README expansion
- **Exit:** signed 1.0 on Linux/Windows/macOS.

## Administrator-client roadmap (Adminer-gap → milestones)

Ordered by value × dependency. These turn fordb from a browse/query client into a master DBA tool. Each maps directly to an Adminer control fordb lacks today.

### MA1 — Editable data grid (the headline gap)

- New `DataEditor` capability: primary-key detection (reuse `getKeys`), and generated parameterized `UPDATE`/`INSERT`/`DELETE` from grid edits.
- Grid: inline cell edit, add-row, delete-row, edit-selected — dirty cells tracked; **SQL preview** of the pending change set; apply in one transaction; row-level errors surfaced.
- Edit-as-form for wide/blob rows; NULL toggle; type-aware inputs.
- Capability: Postgres + SQLite full; MongoDB = document edit (later, its own shape).
- **Exit:** edit/insert/delete rows in the grid on PG and SQLite, previewed + transactional; contract test proves the round-trip.

### MA2 — Table browse + filter/sort + FK navigation

- No-SQL **browse mode**: paginated `SELECT` with per-column **filter** (WHERE builder), **sort** (server-side `ORDER BY` — retires the deferred client-sort), limit/offset.
- **Foreign-key navigation:** click a FK value → generated filtered browse of the referenced row (and reverse: "rows referencing this"). Keyboard-first, huge for exploration.
- **Cross-table value search:** "find `foo@example.com` anywhere in this database" → union of matches per table.
- **Exit:** browse a table with filters + sort, jump across FKs, and search a value DB-wide — no SQL typed.

### MA3 — Structure page + DDL

- New `SchemaEditor` capability: view a table's full structure (columns/keys/indexes + reconstructed DDL) and generate DDL for: create/alter/drop table, add/rename/drop column, change type/default/nullable, add/drop index, add/drop foreign key — each **previewed** then applied.
- Create/drop **database & schema**.
- Engine-gated: Postgres full; SQLite via its limited `ALTER TABLE` (+ table-rebuild for unsupported alters); the capability advertises what's possible so the UI only offers valid ops.
- **Exit:** create a table, add a column + index + FK, and drop them, all previewed; contract test per supported op.

### MA4 — Query power tools

- **EXPLAIN / EXPLAIN ANALYZE** button on the current statement → formatted plan view.
- Persistent **query history** + **saved queries** (named, per-connection).
- SQL **format/prettify** command.
- **Exit:** explain a query, re-run from history, save a query — all from the palette.

### MA5 — Export / import (dump & load)

- **Export** beyond result CSV/JSON: dump a table or whole database as SQL (structure + data, `INSERT` or `COPY`/CSV), gzip option.
- **Import:** run a `.sql` file (statement-split, transactional); load a CSV into a table (column mapping).
- **Exit:** dump a DB to SQL and restore it into an empty one; import a CSV.

### MA6 — Objects: views, routines, triggers

- Browse + show definitions for views, functions/procedures, triggers (and PG-specifics: sequences, types); create/edit where practical.
- Extends the schema tree with object categories; `SchemaEditor` covers create/drop.
- **Exit:** list and view definitions of views/functions/triggers; create/drop a view.

### MA7 — Server administration

- New `ServerAdmin` capability (Postgres-first): **kill / cancel a backend** from the sessions dashboard (the deferred `pg_cancel_backend`/`pg_terminate_backend`, behind confirm), **users & privileges** (roles, grants), server settings view.
- Rounds out the read-only dashboard into actual administration.
- **Exit:** cancel/terminate a session from the dashboard; view roles and their grants.

### Suggested order

MA1 (editing) → MA2 (browse/filter/FK) → MA3 (structure/DDL) → MA4 (query tools) → MA5 (export/import) → MA6 (objects) → MA7 (server admin). MA1–MA3 are the core DBA surface; interleave **M5 (release pipeline)** after MA1–MA2 so a genuinely useful build ships early, and **M7 (MongoDB)** whenever the multi-engine wedge is the priority. Each MA milestone gets its own brainstorm → spec → plan → per-task-PR cycle.

## Sequencing notes

- M1 before any UI: adapter contract is the foundation; UI consumes it.
- Command palette in M3, not later — retrofitting keyboard-first is expensive (PRD principle).
- Perf gate lands in M5 and stays in CI forever — leanness regression = failed build.
- Next action: break M0 + M1 into implementation stories.

# fordb — Work Plan

Milestones ordered by dependency. Each milestone ships something runnable. Stories to be broken out per milestone when it starts (M1 first).

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

## Sequencing notes

- M1 before any UI: adapter contract is the foundation; UI consumes it.
- Command palette in M3, not later — retrofitting keyboard-first is expensive (PRD principle).
- Perf gate lands in M5 and stays in CI forever — leanness regression = failed build.
- Next action: break M0 + M1 into implementation stories.

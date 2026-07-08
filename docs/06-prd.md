# fordb — Product Requirements Document

Status: Approved 2026-07-08 · License: MIT · Working repo: forinda-db-client

## 1. Problem

Existing database GUIs force a bad trade: single-engine tools (pgAdmin, MongoDB Compass) mean one app per database; multi-engine tools are either heavyweight (DataGrip, DBeaver), paywalled on engines (Beekeeper Studio charges for MongoDB), or shallow (Sqlectron). Nobody in open source ships a lean, keyboard-first, multi-engine client with all engines free.

## 2. Product

**fordb** — a lean, keyboard-first, open-source (MIT) desktop database client.

- Engines: PostgreSQL (v0.1) → SQLite (v0.2) → MongoDB (v0.3). All free, forever — no paywalled engines.
- Platforms: Linux (deb, AppImage, AUR) + Windows (NSIS) from v0.1; macOS at v1.0.
- Leanness is a measured feature, not an adjective: published cold-start and RAM numbers each release.

### Non-goals (permanent scope discipline)
No ERD designers, no report builders, no migration frameworks, no dashboards, no AI chat. If a feature compromises lean + keyboard-first, it dies.

## 3. Users

1. Backend/full-stack developer working across Postgres + Mongo + SQLite in one project — today needs 3 apps.
2. Developer on modest hardware who finds DataGrip/DBeaver too heavy.
3. Keyboard-driven developer (vim/tiling-WM crowd) underserved by mouse-first GUIs.

## 4. Architecture

Electron + TypeScript. Three processes:

```
renderer (React UI — no Node, contextBridge only)
   │  AdapterClient: implements DbAdapter, proxies over MessagePort RPC
   ▼
utilityProcess "db-host" (all drivers + native modules)
   │  AdapterRegistry
   ├─ PostgresAdapter (pg)            v0.1
   ├─ SqliteAdapter (better-sqlite3)  v0.2
   └─ MongoAdapter (mongodb)          v0.3

main process: windows, menus, updater, keychain only
```

- **DbAdapter contract** (async + serializable — the core asset):
  `connect/disconnect · listDatabases · listSchemas/Tables/Views · getColumns/Keys/Indexes · executeQuery → {rows, fields, rowCount, command} · fetchPage (cursor streaming) · cancel`
- Same interface both sides of IPC (Beekeeper's proven pattern) — UI never knows queries cross a process boundary; engines pluggable, process model swappable.
- Connections: 1 per query tab + 1 utility connection per server (cancel via `pg_cancel_backend`, introspection).
- SSH tunnels (tunnel-ssh: password / private key + passphrase / agent) owned by db-host, lifecycle tied to connection.
- Secrets in OS keychain via Electron `safeStorage`; profiles in local JSON.

## 5. v0.1 — Read-only Postgres core

| Feature | Requirement |
|---|---|
| Connection manager | Saved profiles: host/port/db/user/password, SSL (CA, client cert/key, trust-server toggle), SSH (password/key/agent). Test-connection button. |
| Schema tree | react-arborist, lazy-loaded: server → databases → schemas → tables/views → columns. Virtualized for 1k+ tables. |
| SQL editor | CodeMirror 6 + lang-sql. Schema-aware autocomplete, multiple tabs, run selection/statement/all, local query history. |
| Results grid | Glide Data Grid, virtualized. Cursor-based page streaming (pg-cursor) — 500k-row results without renderer freeze. Cell copy, client-side sort per page. |
| Export | CSV + JSON of current result set. |
| Command palette | Ctrl+K, primary navigation. Every action is a registered command with optional shortcut. Ships in v0.1 — keyboard-first is a design principle, not a feature. |
| Query cancel | Stop button + shortcut; `pg_cancel_backend` over utility connection. |

Out of v0.1: row editing, table-data browse mode, any second engine.

## 6. Roadmap

- **v0.2** — Row/cell editing with generated-SQL preview before apply; SQLite adapter (better-sqlite3 behind async interface; node:sqlite swap-in when stable in our Electron); table-data browse mode (no SQL needed).
- **v0.3** — MongoDB adapter: collections tree, filter bar, JSON tree view (@uiw/react-json-view) + raw view (CM6 JSON mode). Free — this is the wedge vs Beekeeper/Compass.
- **v1.0** — macOS (Developer ID + notarization), Windows signing (SignPath Foundation → IV cert ladder per doc 02), Flathub, auto-update polish.

## 7. Tech stack (research-verified, docs 01–04)

| Slot | Choice |
|---|---|
| Shell | Electron (doc 01: wins Linux reliability, rendering consistency, pure-TS drivers) |
| UI | React 19 + TypeScript, Vite + electron-vite, Zustand |
| Grid | Glide Data Grid (canvas, MIT, ~64KB gzip; TanStack Table+Virtual fallback if maintenance stall bites) |
| Editor | CodeMirror 6 + @codemirror/lang-sql |
| Tree | react-arborist |
| Drivers | pg 8.x (+pg-cursor), better-sqlite3, mongodb 7.x, ssh2/tunnel-ssh |
| Packaging | electron-builder; GitHub Actions matrix (doc 02 workflow) |

## 8. Success criteria (v0.1 release gate)

1. Cold start < 2s, idle RAM < 300MB on a mid-range Linux laptop — measured in CI, published in README.
2. Connect to remote Postgres over SSH tunnel; browse a 1,000-table schema without lag.
3. Run a query returning 500k rows; grid stays responsive (streamed pages).
4. Complete connect → query → export entirely without a mouse.
5. Installers: deb + AppImage + NSIS from one tagged release; AUR package auto-published.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Glide Data Grid maintenance stalled (last release Feb 2024) | Pin version; grid usage isolated behind our own ResultsGrid component so TanStack fallback is a component swap |
| better-sqlite3 Electron ABI rebuild tax (v0.2) | @electron/rebuild + asarUnpack, known recipe; adapter interface already async for node:sqlite swap |
| Beekeeper un-paywalls engines | Wedge also rests on keyboard-first + measured leanness, not price alone |
| Solo-dev scope creep | Non-goals list above; every feature must pass lean + keyboard-first test |

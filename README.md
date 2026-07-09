# fordb

**A lean, keyboard-first, open-source desktop database client.** Postgres and SQLite today, MongoDB planned — every engine free in core. Built with Electron + TypeScript.

fordb sits between the two extremes: lighter than DataGrip/DBeaver, but multi-engine unlike the single-database clients (pgAdmin, Compass). Fast to open, driven from the keyboard, and honest about your data — every destructive change is previewed as SQL and confirmed before it runs.

> **Status:** early and under active development (`v0.0.1`). No packaged installers are published yet — run it from source (see [Getting started](#getting-started)). The core — Postgres + SQLite, editing, browse, structure/DDL, and query tools — works and is tested.

## Why fordb

- **Multi-engine, all free.** Postgres and SQLite (local file, remote libsql/Turso, and embedded replicas) work in core. No paid tier gates an engine.
- **Keyboard-first.** A command palette (`Ctrl/Cmd-K`) reaches every action; the SQL editor runs on `Mod-Enter`.
- **Secrets stay out of the UI.** Connection passwords and tokens live in the OS keychain, in the main process — the window (renderer) only ever holds an opaque connection id. See [Architecture](#architecture).
- **Destructive = previewed + confirmed.** Row edits, DDL, and drops all show the generated SQL and require an explicit confirm before applying, in a transaction where the engine supports it.

## Features

**Connections**

- Postgres, and SQLite in three flavours: local file, remote (libsql/Turso), and embedded replica (a local file synced from a remote).
- Passwords / auth tokens stored via the OS keychain (`safeStorage`); nothing secret is written to the profiles file or sent to the renderer.
- Switch databases on the same Postgres server without re-adding a connection.

**Explore**

- Lazy schema tree (schemas → tables/views → columns), shared with the SQL autocomplete.
- Table **data browsing** with per-column filters, sortable headers, and foreign-key navigation — click a FK value to jump to the referenced row. No SQL required.
- Server-stats **dashboard** (Postgres): sessions, locks, connection load, live charts — useful for spotting zombie connections and load.

**Edit**

- Editable data grid: change cells, insert and delete rows, set NULL — all staged, previewed, and applied transactionally by primary/unique key.
- **Structure page + DDL**: view columns/keys/indexes and a reconstructed `CREATE TABLE`; create tables, add/rename/drop columns, change type/default/nullable, add/drop indexes and foreign keys, drop tables — Postgres in place, SQLite via native `ALTER` or a safe table-rebuild (data, indexes, and constraints preserved).

**Query**

- CodeMirror 6 editor with SQL syntax highlighting (light/dark, tracks the app theme) and schema-aware autocomplete.
- Streaming result grid for large results, with cancel and CSV/JSON export.
- **Format** SQL, **EXPLAIN / EXPLAIN ANALYZE** plan view, per-connection **query history**, and named **saved queries** — all from the palette or the toolbar.

## Getting started

**Prerequisites:** [Node.js](https://nodejs.org) ≥ 22 and [pnpm](https://pnpm.io). [Docker](https://www.docker.com) is only needed for the contract test suite.

```bash
pnpm install
pnpm dev          # launch the app in dev mode
```

On Linux, if you hit a chrome-sandbox permission error, use:

```bash
pnpm dev:sandboxless
```

### Commands

| Command                       | What it does                                       |
| ----------------------------- | -------------------------------------------------- |
| `pnpm dev`                    | Run the app in development (hot reload)            |
| `pnpm dev:sandboxless`        | Same, without the chrome sandbox (Linux fallback)  |
| `pnpm build`                  | Typecheck + build the production bundles           |
| `pnpm test`                   | Unit tests (vitest)                                |
| `pnpm db:up` / `pnpm db:down` | Start / stop the Postgres + libsql test containers |
| `pnpm test:contract`          | Adapter contract suite (needs `db:up`; Docker)     |
| `pnpm e2e`                    | End-to-end tests (Playwright, headless SQLite)     |
| `pnpm lint`                   | ESLint + Prettier check                            |
| `pnpm typecheck`              | TypeScript, both project configs                   |

## Architecture

Three Electron processes, so a compromised renderer can never touch a driver or a secret directly:

```
renderer (React 19 + Tailwind v4 + Zustand — no Node, contextBridge only)
   │  window.fordb.*  ── IPC ──►  main
   │  RPC over MessagePort (addressed by connectionId) ──►  db-host
   ▼
main (windows, OS keychain, profile/secret stores, db-host supervision)
   │  privileged control channel (carries secrets) ──►  db-host
   ▼
db-host (utilityProcess — all DB drivers)
   └─ ConnectionRegistry: connectionId → adapter   (Postgres · SQLite · …)
```

- **Secrets never reach the renderer.** The window sends a `profileId`; main loads the profile, decrypts its secrets from the keychain, merges them, and hands the full profile to db-host over a private control channel. The renderer only holds an opaque `connectionId`.
- **`DbAdapter` is the core contract** — async and serializable so it crosses the process boundary unchanged. Every engine implements it; a shared contract-test suite enforces it. Optional capabilities (`dataMutator`, `dataBrowser`, `schemaEditor`, `serverStats`) are engine-gated, so the UI only offers what an engine actually supports.

Full details in [AGENTS.md](AGENTS.md).

## Tech stack

Electron · TypeScript (strict) · React 19 · Tailwind CSS v4 · Zustand · TanStack Query · CodeMirror 6 · Glide Data Grid · `pg` (Postgres) · `@libsql/client` (SQLite) · vitest · Playwright · electron-vite.

## Project layout & docs

```
src/
  main/       # windows, keychain, profile/secret/query-library stores, IPC
  preload/    # contextBridge — the window.fordb surface
  renderer/   # React app (components, Zustand stores, CodeMirror)
  db-host/    # utilityProcess: DbAdapter implementations + ConnectionRegistry
  shared/     # cross-process contracts (adapter, DDL/browse builders, rpc)
tests/        # unit · contract (per-engine) · e2e (Playwright)
docs/         # PRD, work plan, specs, and per-milestone implementation plans
```

| Doc                                                     | What                                                |
| ------------------------------------------------------- | --------------------------------------------------- |
| [AGENTS.md](AGENTS.md)                                  | Architecture + coding conventions (**start here**)  |
| [CONTRIBUTING.md](CONTRIBUTING.md)                      | Dev setup, commands, workflow                       |
| [docs/06-prd.md](docs/06-prd.md)                        | Product requirements                                |
| [docs/07-work-plan.md](docs/07-work-plan.md)            | Milestones + roadmap                                |
| [docs/specs/](docs/specs/) · [docs/plans/](docs/plans/) | Per-milestone design specs and implementation plans |

## Contributing

Contributions welcome. Read [AGENTS.md](AGENTS.md) (conventions) and [CONTRIBUTING.md](CONTRIBUTING.md) (setup) first. The workflow is spec → plan → task-by-task, one PR per task, with tests kept green (`pnpm typecheck && pnpm lint && pnpm test`).

## License

[MIT](LICENSE) © fordb contributors.

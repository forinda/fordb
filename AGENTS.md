# AGENTS.md — fordb architecture & coding conventions

Single source of truth for how this codebase is structured and the conventions to follow. Human contributors: see also [CONTRIBUTING.md](CONTRIBUTING.md) for setup. AI agents: this file is your map — read it before editing.

## What fordb is

A lean, keyboard-first, open-source (MIT) desktop database client. Engines: PostgreSQL (shipped), SQLite (planned v0.2), MongoDB (planned v0.3) — all free in core. Electron + TypeScript. Full product rationale in [docs/06-prd.md](docs/06-prd.md).

## Architecture

Three Electron processes:

```
renderer (React 19 + Tailwind v4 + Zustand — NO Node, contextBridge only)
   │  window.fordb.* (preload bridge)  ── IPC ──►  main
   │  getDbHostPort() → PortLike        ── RPC ──►  db-host (introspection by connectionId)
   ▼
main (windows, menus, keychain, profile/secret stores, db-host supervision)
   │  hostControl: HostApi  ── private control-port RPC ──►  db-host (secret-bearing open/test)
   ▼
db-host (utilityProcess — all DB drivers + native modules)
   │  ConnectionRegistry (process singleton): connectionId → { adapter, tunnel? }
   └─ PostgresAdapter (pg) · SqliteAdapter (planned) · MongoAdapter (planned)
```

Key rules that fall out of this:

- **Secrets never reach the renderer.** The renderer sends a `profileId`; main loads the profile, decrypts secrets from the OS keychain (`safeStorage`), merges them into the profile, and calls db-host. The renderer only ever holds an opaque `connectionId`.
- **Connections are addressed by `connectionId`, not by port.** The `ConnectionRegistry` is a db-host process singleton; a `HostApi` facade is served on every RPC port (main's control port + each renderer port), all backed by that one registry. Closing a renderer port must NOT drop registry connections.
- **The `DbAdapter` interface is the core asset.** It's async + serializable so it crosses the process boundary unchanged. Every engine implements it; a shared contract test suite enforces it.

## Architectural flow

Two channels reach db-host: a **privileged control channel** (main ↔ db-host, carries secrets) and a **renderer data channel** (renderer ↔ db-host, connectionId only). Follow the two lifecycles:

**Opening a connection** (secret-bearing → goes through main):

1. Renderer calls `window.fordb.connection.open(profileId)` (preload → IPC to main).
2. Main **hydrates**: `ProfileStore` loads the profile, `SecretStore` decrypts its secrets from the keychain, main merges them into a full `ConnectionProfile`.
3. Main calls `hostControl.openConnection(profile)` over the **control** port.
4. db-host's `ConnectionRegistry.open` sets up an SSH tunnel if `profile.ssh` is present, constructs the engine adapter, connects it, stores `{adapter, tunnel?}` under a fresh `connectionId`, and returns that id.
5. The id flows back main → renderer. The renderer now holds only the opaque `connectionId`; secrets stayed in main and db-host.

**Reading schema / running a query** (no secrets → renderer talks to db-host directly):

1. Renderer gets its `HostApi` client via `hostApi()` (RPC over `getDbHostPort`).
2. Renderer calls e.g. `listSchemas(connectionId)` / `listTables(connectionId, schema)`.
3. db-host's `HostApiImpl` routes by id through `registry.get(connectionId)` to the adapter; an unknown id becomes an RPC rejection.
4. Results serialize back over the port. Large result sets stream page-by-page via the adapter's cursor methods.

**Supporting flows:** `testConnection` mirrors the open flow (hydrate → control port) but opens a throwaway adapter, runs `SELECT 1`, and always closes — it never registers a connection. If db-host crashes, main's supervisor respawns it with backoff; in-flight RPC calls reject, and the renderer surfaces the loss rather than hanging.

## Folder layout (a map, not an inventory — files move; trust the layout, grep for specifics)

```
src/
  shared/    types + DbAdapter + HostApi contracts, and the transport-agnostic RPC layer
             (imported by BOTH main-side and renderer; compiles under both tsconfigs)
  main/      window/menu/keychain, profile + secret stores, IPC handlers, db-host supervision
  preload/   contextBridge → window.fordb (ESM; emits index.mjs)
  db-host/   utilityProcess: ConnectionRegistry, HostApi impl, SSH tunnel, per-engine adapters (postgres/, …)
  renderer/  React UI: RPC client, Zustand store, components
tests/
  unit/      fast, no Docker — `pnpm test`
  contract/  against Dockerized Postgres — `pnpm test:contract`; adapter-contract.ts is the shared suite every engine must pass
```

The load-bearing contracts live in `src/shared` — `adapter/db-adapter.ts` (engine interface), `host/host-api.ts` (connectionId-routed facade), `rpc/` (PortLike transport). Start there when tracing anything.

## Conventions

- **TypeScript strict, `noUncheckedIndexedAccess`.** No `any` except typed casts (`unknown`) at the RPC/serialization boundary.
- **Files stay focused** — one clear responsibility. Split by responsibility, not layer.
- **TDD.** Write the failing test first. Non-trivial logic leaves a runnable check.
- **Two test tiers:**
  - Unit (`tests/unit`, `pnpm test`) — pure logic, mocks for keychain, no Docker.
  - Contract (`tests/contract`, `pnpm test:contract`) — real Postgres via `pnpm db:up`. Every engine adapter passes the shared `runAdapterContractTests` suite.
- **Secrets:** any new secret-like field on `ConnectionProfile` MUST be stripped in `ProfileStore.save()` and routed through the keychain — never persisted in `profiles.json`, never returned to the renderer. See the comment block on `ConnectionProfile`.
- **RPC methods** are async/serializable. Introspection methods on `HostApiImpl` rely on `serveRpc` converting a sync throw into a rejection — they must only be invoked via the RPC layer.
- **Native modules in db-host** (pg-native, ssh2's cpu-features) are externalized in `electron.vite.config.ts` main build so their optional `require` stays dynamic behind pg/ssh2's own try/catch.
- **Preload is ESM** (`out/preload/index.mjs`); main loads that path.
- **Commits:** conventional-style subject (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `style:`, `harden:`). Keep commits scoped.

## Adding a new engine adapter (the intended extension path)

1. Implement `DbAdapter` (see `postgres/postgres-adapter.ts`).
2. Add a `*.contract.test.ts` that runs `runAdapterContractTests(() => new YourAdapter(), profile)` — it must pass the identical suite. Move engine-specific tests (e.g. `pg_sleep` cancel) behind a capability flag if needed.
3. Register it in the `ConnectionRegistry`'s `makeAdapter` selection by `profile.engine`.
4. Native module? Externalize it in the vite main build.

## Where the rest of the context lives

- Product/requirements: [docs/06-prd.md](docs/06-prd.md)
- Roadmap/milestones: [docs/07-work-plan.md](docs/07-work-plan.md)
- Research (framework, packaging, drivers, UI, competitors): [docs/01–05](docs/README.md)
- Design specs: [docs/specs/](docs/specs/) · Implementation plans: [docs/plans/](docs/plans/)

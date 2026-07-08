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

## File structure

```
src/
  shared/                     # imported by BOTH main-side and renderer (compiles under both tsconfigs)
    adapter/types.ts          # ConnectionProfile, ColumnInfo, QueryResult, … (+ secret fields, SshOptions)
    adapter/db-adapter.ts     # DbAdapter interface — the engine contract
    host/host-api.ts          # HostApi interface (connectionId-routed), TestResult, ConnectionId
    rpc/                      # transport-agnostic RPC over a PortLike abstraction
      protocol.ts             # RpcRequest/Response, RpcError, PortLike
      server.ts               # serveRpc(port, target)
      client.ts               # createRpcClient<T>(port)
  main/
    index.ts                  # BrowserWindow, spawns db-host, control port, supervision
    ipc.ts                    # registerIpc — profiles:*/connection:* handlers, secret hydrate
    profile-store.ts          # profiles.json (secrets stripped)
    secret-store.ts           # secrets via safeStorage, NO plaintext fallback
  preload/index.ts            # contextBridge → window.fordb (ESM: emits index.mjs)
  db-host/
    index.ts                  # singleton ConnectionRegistry, serves HostApi per port
    connection-registry.ts    # multi-connection registry (open/get/close), SSH tunnel wiring
    host-api-impl.ts          # HostApiImpl — testConnection + connectionId routing
    ssh-tunnel.ts             # buildTunnelConfig (pure) + openTunnel (tunnel-ssh)
    postgres/                 # PostgresAdapter + introspection SQL
  renderer/src/
    rpc.ts                    # hostApi() — renderer's HostApi client over getDbHostPort
    store.ts                  # Zustand useConnStore
    components/               # ConnectionList, ProfileForm, SchemaTree, CommandPalette
    App.tsx, main.tsx, index.css (Tailwind entry)
tests/
  unit/**/*.test.ts           # fast, no Docker — run by `pnpm test`
  contract/**/*.contract.test.ts   # against Dockerized Postgres — run by `pnpm test:contract`
  contract/adapter-contract.ts     # engine-agnostic suite every adapter must pass
```

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

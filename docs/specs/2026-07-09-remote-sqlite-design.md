# fordb — Remote & Embedded-Replica SQLite (libsql): Design Spec

Status: Approved 2026-07-09 · Milestone: M-SQLiteRemote (after M-SQLite) · References: SQLite adapter spec, `DbAdapter` contract, M2 keychain/secret handling.

Extends the SQLite engine to reach **remote** libsql/Turso databases and **embedded replicas** (a local file that syncs from a remote), in addition to plain local files. `@libsql/client` already supports all three via `createClient` — the work is the profile shape, secret handling for the auth token, the form, and test coverage.

## Goal / exit criterion

A user can create a SQLite connection of three kinds — **Local file**, **Remote** (`libsql://`/`https://` URL + auth token), or **Embedded replica** (local file + a remote sync URL + token) — connect, and get the same workbench experience (browse, query, autocomplete). The auth token is stored in the keychain, never in `profiles.json`. Remote and replica are contract-tested against a local `sqld` container. No regression to local SQLite or Postgres.

## Non-goals (v1)

- **Sync cadence:** replicas `sync()` **once on connect** only. No background `syncInterval`, no "Sync now" button (both are easy later adds).
- **No write-conflict UI / offline queue** — libsql handles replica writes (they go to the remote); we don't add UX around it.
- **No Turso platform API** (creating DBs, managing tokens) — the user brings a URL + token.
- **No auth on the test `sqld`** — it runs open; token wiring is unit-tested separately (see §6).

## Decisions locked during design

- Profile: **sub-discriminated** `SqliteProfile = SqliteLocal | SqliteRemote | SqliteReplica` (on `kind`).
- Scope: **remote + embedded replica** (not just remote).
- Testing: **local `sqld` (libsql-server) in Docker** for the remote/replica wire tests; **injectable client factory + unit test** for token wiring.
- Replica syncs **on connect only**.
- `sqld` runs **no-auth**; the token is exercised by the unit test, not the container.

## 1. Profile shapes (`src/shared/adapter/types.ts`)

```ts
interface SqliteBase extends BaseProfile {
  engine: 'sqlite'
}
export interface SqliteLocal extends SqliteBase {
  kind: 'local'
  file: string
}
export interface SqliteRemote extends SqliteBase {
  kind: 'remote'
  url: string // libsql:// or https:// or http://
  authToken?: string // SECRET — transient, never persisted
}
export interface SqliteReplica extends SqliteBase {
  kind: 'replica'
  file: string // local replica file
  syncUrl: string // remote to sync from
  authToken?: string // SECRET
}
export type SqliteProfile = SqliteLocal | SqliteRemote | SqliteReplica
export type ConnectionProfile = PostgresProfile | SqliteProfile
```

**Migration note:** the existing `SqliteProfile` (`{ engine:'sqlite', file }`) becomes `SqliteLocal` with an added `kind:'local'`. Any persisted profile from the just-merged milestone lacks `kind`; treat a `sqlite` profile with no `kind` as `local` (a one-line normalization on read in `ProfileStore.list()`), so existing saved connections keep working.

- `connectionLabel`: remote → `name || url`; local/replica → `name || basename(file)`.

## 2. Secret handling — the token joins the keychain

SQLite is no longer _structurally_ secretless. New invariant: **local is secretless; remote/replica route `authToken` through the keychain, never persisted.**

- The secrets bag (`ipc` ↔ `SecretStore` ↔ `ProfileForm.secrets()`) gains `authToken?: string`. Type: `{ password?; sshPassword?; sshPassphrase?; authToken? }`.
- `ProfileStore.save()` strip switch: for `engine==='sqlite'` with `kind` `remote`/`replica`, omit `authToken` from the persisted object (destructure it out); `local` and Postgres unchanged.
- `ipc hydrate`: inject `authToken` from `SecretStore` when the profile is sqlite remote/replica (alongside the existing postgres-secrets branch).
- `ProfileForm.secrets()`: returns `{ authToken }` for remote/replica (and the PG secrets for postgres); `{}` for local.
- `SecretStore` already stores an opaque `StoredSecrets` object — add `authToken` to that shape (encrypted with the rest). No plaintext fallback, same as today.

## 3. Adapter — connect by kind (`src/db-host/sqlite/sqlite-adapter.ts`)

Only `connect()` changes; every other method is client-agnostic and untouched.

```ts
async connect(profile: ConnectionProfile): Promise<void> {
  if (profile.engine !== 'sqlite') throw new Error('SqliteAdapter requires a sqlite profile')
  const client = this.makeClient(configFor(profile)) // makeClient injectable — see §6
  if (profile.kind === 'replica') await client.sync()
  this.client = client
}
```

`configFor(profile)` (pure, testable):

- `local` → `{ url: 'file:' + profile.file }`
- `remote` → `{ url: profile.url, authToken: profile.authToken }`
- `replica` → `{ url: 'file:' + profile.file, syncUrl: profile.syncUrl, authToken: profile.authToken }`

Writes to a replica propagate to the remote (libsql); reads use the local snapshot from the connect-time `sync()`.

## 4. ProfileForm (`src/renderer/src/components/ProfileForm.tsx`)

Engine=SQLite gains a **kind** `Select` (Local file · Remote · Embedded replica):

- **local** — file `Input` + Browse… (current UI).
- **remote** — `url` `Input` + `authToken` (password-type `Input`).
- **replica** — file `Input` + Browse…, `syncUrl` `Input`, `authToken` (password-type).

`build()` returns the matching variant. `secrets()` returns `{ authToken }` for remote/replica.

## 5. Test container — `sqld`

Add a `libsql` service to `docker-compose.test.yml`:

```yaml
libsql:
  image: ghcr.io/tursodatabase/libsql-server:latest
  ports: ['8080:8080']
  environment:
    SQLD_NODE: primary
```

`pnpm db:up` starts it alongside Postgres. Remote URL for tests: `http://127.0.0.1:8080`.

## 6. Testing

- **Injectable client factory:** `SqliteAdapter` takes an optional constructor arg `makeClient = createClient` (defaults to the real one). Enables:
  - **Unit test** `configFor` (pure) for all three kinds — asserts `url`/`authToken`/`syncUrl` are set correctly (deterministic token-wiring coverage, no live server).
  - **Unit test** that `connect()` calls the injected factory with the right config and calls `sync()` only for `replica`.
- **Remote contract** (`sqlite-remote.contract.test.ts`, needs Docker): a `beforeAll` seeds `sqld` via a remote `createClient({ url:'http://127.0.0.1:8080' })` with the mirrored fixture (users/orders/view/index/FK, 1000/5000 rows), then `runAdapterContractTests(() => new SqliteAdapter(), remoteProfile, { database:'main', schema:'main' })`.
- **Replica contract** (`sqlite-replica.contract.test.ts`, needs Docker): same seed into `sqld`; the adapter connects with `syncUrl='http://127.0.0.1:8080'` + a temp local file, `sync()` pulls it down, and the shared contract runs against the synced snapshot. (Streaming/`executeQuery` reads hit the local replica.)
- **Local SQLite + Postgres contracts** unchanged.
- **e2e:** the local SQLite e2e stays. A remote e2e is out of scope (needs the container wired into the Playwright run); remote is covered by the contract test.
- Existing unit + contract stay green.

## 7. File structure

```
src/shared/adapter/types.ts                 # MODIFY: SqliteProfile → local|remote|replica sub-union; secrets bag + authToken
src/shared/connection-label.ts              # MODIFY: remote → url label
src/db-host/sqlite/sqlite-config.ts         # NEW: configFor(profile) (pure)
src/db-host/sqlite/sqlite-adapter.ts        # MODIFY: injectable makeClient; connect by kind + sync
src/main/profile-store.ts                   # MODIFY: normalize legacy sqlite→local; strip authToken (remote/replica)
src/main/secret-store.ts                    # MODIFY: StoredSecrets gains authToken
src/main/ipc.ts                             # MODIFY: hydrate injects authToken for sqlite remote/replica; secrets:save handles authToken
src/preload/index.ts / rpc.ts               # MODIFY: secrets arg type gains authToken
src/renderer/src/components/ProfileForm.tsx # MODIFY: kind selector + remote/replica fields
docker-compose.test.yml                     # MODIFY: add sqld service
tests/contract/sqlite-remote.contract.test.ts   # NEW
tests/contract/sqlite-replica.contract.test.ts  # NEW
tests/contract/sqld-seed.ts                 # NEW: seed helper (remote client → fixture)
tests/unit/sqlite-config.test.ts            # NEW: configFor + connect-wiring
```

## 8. Risks

| Risk                                                         | Mitigation                                                                                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Legacy saved SQLite profiles lack `kind`                     | Normalize `sqlite` + no `kind` → `local` on read (`ProfileStore.list()`); one-liner, keeps existing connections working                                                                    |
| Token accidentally persisted                                 | Strip switch covers sqlite remote/replica; the union makes `authToken` structural to those kinds so a missed strip is a compile-visible shape; SecretStore no-plaintext-fallback unchanged |
| Embedded-replica native support in the bundled libsql binary | `@libsql/linux-x64-gnu` (installed) supports embedded replicas; the replica contract test proves it at runtime, and it's gated on Docker like the other wire tests                         |
| `sqld` image/version drift breaks CI                         | Pin the image tag; remote/replica tests are Docker-gated (skipped without `db:up`), so they can't break the fast unit suite                                                                |
| Sync-on-connect adds latency / can fail                      | `sync()` errors surface as a connect failure (same as any connect error → "connection lost/failed" UX); documented that v1 syncs once                                                      |

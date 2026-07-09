# fordb Remote & Embedded-Replica SQLite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a SQLite connection be a local file, a remote libsql/Turso database (URL + auth token), or an embedded replica (local file synced from a remote), with the token in the keychain.

**Architecture:** `SqliteProfile` becomes a sub-union (`local | remote | replica`) discriminated on `kind`. A pure `configFor(profile)` maps each kind to a libsql `Config`; `SqliteAdapter` takes an injectable client factory and syncs replicas on connect. The auth token joins the keychain secrets bag. Remote/replica are contract-tested against a local `sqld` container.

**Tech Stack:** TypeScript strict, `@libsql/client`, Electron, React 19, vitest, Docker (`libsql-server`).

## Global Constraints

- pnpm; Node >= 22; TypeScript strict; no `any` except typed casts at the RPC/DB boundary.
- **Secret invariant:** local SQLite is secretless; remote/replica route `authToken` through the keychain, NEVER persisted in `profiles.json`. Same discipline as the Postgres password. No plaintext fallback.
- The sub-union is the safety net: consumers reading kind-specific fields (`file`/`url`/`syncUrl`/`authToken`) must narrow on `kind` or fail to compile.
- Legacy saved `sqlite` profiles (no `kind`) normalize to `local` on read.
- Replicas `sync()` **once on connect** (no interval/manual sync in v1).
- `sqld` test container runs **no-auth**; token wiring is unit-tested, not exercised over the wire.
- `@shared/*` alias. Renderer-importing tests → `tsconfig.web`; pure/db-host tests → `tsconfig.node`.
- Each task ends with `pnpm typecheck && pnpm lint && pnpm test` green (+ `pnpm build` for renderer/build tasks). Contract tasks run `pnpm db:up && pnpm test:contract && pnpm db:down`.
- One PR per task against `main`.

## File Structure (end state)

```
src/shared/adapter/types.ts                 # MODIFY: SqliteProfile → SqliteLocal|SqliteRemote|SqliteReplica
src/shared/connection-label.ts              # MODIFY: remote → url; local/replica → file basename
src/db-host/sqlite/sqlite-config.ts         # NEW: configFor(profile) (pure)
src/db-host/sqlite/sqlite-adapter.ts        # MODIFY: injectable makeClient; connect by kind + sync
src/main/profile-store.ts                   # MODIFY: normalize legacy sqlite→local; strip authToken
src/main/secret-store.ts                    # MODIFY: StoredSecrets + authToken
src/main/ipc.ts                             # MODIFY: save + hydrate handle authToken (sqlite remote/replica)
src/preload/index.ts                        # MODIFY: secrets arg type + authToken
src/renderer/src/rpc.ts                     # MODIFY: secrets arg type + authToken
src/renderer/src/components/ProfileForm.tsx # MODIFY: kind selector + remote/replica fields
docker-compose.test.yml                     # MODIFY: add libsql (sqld) service
tests/contract/sqld-seed.ts                 # NEW: seed helper (remote client → fixture)
tests/contract/sqlite-remote.contract.test.ts   # NEW
tests/contract/sqlite-replica.contract.test.ts  # NEW
tests/unit/sqlite-config.test.ts            # NEW: configFor + connect-wiring
```

---

### Task 1: SqliteProfile sub-union + consumer narrowing

**Files:**

- Modify: `src/shared/adapter/types.ts`, `src/shared/connection-label.ts`, `src/main/profile-store.ts`, `src/db-host/sqlite/sqlite-adapter.ts`, `src/renderer/src/components/ProfileForm.tsx`
- Test: `tests/unit/connection-label.test.ts`

**Interfaces:**

- Produces: `SqliteLocal`, `SqliteRemote`, `SqliteReplica`, `SqliteProfile = SqliteLocal | SqliteRemote | SqliteReplica`.

- [ ] **Step 1: The sub-union**

Modify `src/shared/adapter/types.ts` — replace the current `SqliteProfile` interface with:

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
  url: string
  authToken?: string // SECRET — transient, never persisted
}
export interface SqliteReplica extends SqliteBase {
  kind: 'replica'
  file: string
  syncUrl: string
  authToken?: string // SECRET
}
export type SqliteProfile = SqliteLocal | SqliteRemote | SqliteReplica
```

(`ConnectionProfile = PostgresProfile | SqliteProfile` line stays.)

- [ ] **Step 2: connection-label test for remote**

Add to `tests/unit/connection-label.test.ts` (inside the describe):

```ts
it('sqlite remote falls back to the url', () => {
  expect(
    connectionLabel({
      id: 'r',
      name: '',
      engine: 'sqlite',
      kind: 'remote',
      url: 'libsql://x.turso.io'
    })
  ).toBe('libsql://x.turso.io')
})
it('sqlite replica falls back to the file basename', () => {
  expect(
    connectionLabel({
      id: 'r',
      name: '',
      engine: 'sqlite',
      kind: 'replica',
      file: '/tmp/rep.sqlite',
      syncUrl: 'libsql://x'
    })
  ).toBe('rep.sqlite')
})
```

Update the existing sqlite label tests to include `kind: 'local'` (they currently pass `{engine:'sqlite', file}` which no longer type-checks).

- [ ] **Step 3: connection-label narrows on kind**

Modify `src/shared/connection-label.ts` — replace the sqlite branch:

```ts
if (profile.engine === 'sqlite') {
  if (profile.kind === 'remote') return profile.url.trim() || 'SQLite (remote)'
  const base = profile.file.split(/[\\/]/).pop() ?? profile.file
  return base || 'SQLite database'
}
```

- [ ] **Step 4: Normalize legacy profiles on read**

Modify `src/main/profile-store.ts` `list()` — after parsing, map any `sqlite` profile lacking `kind` to `local`:

```ts
const list = JSON.parse(raw) as ConnectionProfile[]
return list.map((p) =>
  p.engine === 'sqlite' && !('kind' in p) ? { ...p, kind: 'local' as const } : p
)
```

(Replace the current `return JSON.parse(raw) as ConnectionProfile[]`.)

- [ ] **Step 5: Adapter connect compiles (local only for now)**

Modify `src/db-host/sqlite/sqlite-adapter.ts` `connect()` — the current body reads `profile.file`, which no longer exists on `SqliteRemote`. Keep local working, defer remote/replica to Task 4:

```ts
  async connect(profile: ConnectionProfile): Promise<void> {
    if (profile.engine !== 'sqlite') throw new Error('SqliteAdapter requires a sqlite profile')
    if (profile.kind !== 'local') throw new Error('remote/replica sqlite not wired yet')
    this.client = createClient({ url: `file:${profile.file}` })
  }
```

- [ ] **Step 6: ProfileForm build emits kind:'local'**

Modify `src/renderer/src/components/ProfileForm.tsx` — the sqlite branch of `build()` currently returns `{ id, name, engine:'sqlite', file }`. Add `kind: 'local' as const` (import `SqliteLocal`):

```ts
if (engine === 'sqlite') {
  const base: SqliteLocal = { id: p?.id ?? newId(), name, engine: 'sqlite', kind: 'local', file }
  return { ...base, name: name.trim() || connectionLabel(base) }
}
```

Also the `file` state seed `p?.engine === 'sqlite' ? p.file : ''` no longer type-checks (remote has no file); change to `p?.engine === 'sqlite' && 'file' in p ? p.file : ''`.

- [ ] **Step 7: Verify (compile is the net) + commit**

Run: `pnpm typecheck` (fix any straggler by narrowing on `kind`), then `pnpm lint && pnpm test && pnpm build`. Local SQLite still works; remote/replica throw a clear "not wired yet" until Task 4.

```bash
git add src/shared/adapter/types.ts src/shared/connection-label.ts src/main/profile-store.ts src/db-host/sqlite/sqlite-adapter.ts src/renderer/src/components/ProfileForm.tsx tests/unit/connection-label.test.ts
git commit -m "feat: SqliteProfile sub-union (local | remote | replica)"
```

---

### Task 2: `sqld` test container

**Files:**

- Modify: `docker-compose.test.yml`

- [ ] **Step 1: Add the libsql service**

Append to `docker-compose.test.yml` under `services:`:

```yaml
libsql:
  image: ghcr.io/tursodatabase/libsql-server:latest
  ports:
    - '8080:8080'
  environment:
    SQLD_NODE: primary
  healthcheck:
    test: ['CMD', 'wget', '-q', '-O', '-', 'http://localhost:8080/health']
    interval: 2s
    timeout: 2s
    retries: 20
```

- [ ] **Step 2: Verify it comes up**

Run: `pnpm db:up` then `curl -fsS http://127.0.0.1:8080/health` (expect a 200 / OK). Then a quick libsql round-trip:

```bash
node -e "const{createClient}=require('@libsql/client');(async()=>{const c=createClient({url:'http://127.0.0.1:8080'});const r=await c.execute('SELECT 1 AS one');console.log('sqld ok:',r.rows[0]);})().catch(e=>{console.error(e.message);process.exit(1)})"
```

Expected: `sqld ok: { one: 1 }`. Then `pnpm db:down`.
If the health endpoint path differs for the pinned image, adjust the healthcheck URL; the round-trip is the real gate.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.test.yml
git commit -m "test: add libsql-server (sqld) to the test compose"
```

---

### Task 3: `configFor(profile)` (pure) + unit test

**Files:**

- Create: `src/db-host/sqlite/sqlite-config.ts`, `tests/unit/sqlite-config.test.ts`

**Interfaces:**

- Consumes: `SqliteProfile` (Task 1), libsql `Config`.
- Produces: `configFor(profile: SqliteProfile): Config`.

- [ ] **Step 1: Failing test**

`tests/unit/sqlite-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { configFor } from '../../src/db-host/sqlite/sqlite-config'
import type { SqliteProfile } from '../../src/shared/adapter/types'

const base = { id: 'x', name: 'x', engine: 'sqlite' as const }

describe('configFor', () => {
  it('local → file: url, no token', () => {
    const p: SqliteProfile = { ...base, kind: 'local', file: '/tmp/a.db' }
    expect(configFor(p)).toEqual({ url: 'file:/tmp/a.db' })
  })
  it('remote → url + authToken', () => {
    const p: SqliteProfile = { ...base, kind: 'remote', url: 'libsql://x', authToken: 't' }
    expect(configFor(p)).toEqual({ url: 'libsql://x', authToken: 't' })
  })
  it('replica → file url + syncUrl + authToken', () => {
    const p: SqliteProfile = {
      ...base,
      kind: 'replica',
      file: '/tmp/r.db',
      syncUrl: 'libsql://x',
      authToken: 't'
    }
    expect(configFor(p)).toEqual({ url: 'file:/tmp/r.db', syncUrl: 'libsql://x', authToken: 't' })
  })
})
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm vitest run tests/unit/sqlite-config.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement**

`src/db-host/sqlite/sqlite-config.ts`:

```ts
import type { Config } from '@libsql/client'
import type { SqliteProfile } from '@shared/adapter/types'

/** Maps a SqliteProfile to a libsql client Config. Pure — the adapter injects
 *  the actual client factory (see sqlite-adapter). */
export function configFor(profile: SqliteProfile): Config {
  switch (profile.kind) {
    case 'local':
      return { url: `file:${profile.file}` }
    case 'remote':
      return { url: profile.url, authToken: profile.authToken }
    case 'replica':
      return { url: `file:${profile.file}`, syncUrl: profile.syncUrl, authToken: profile.authToken }
  }
}
```

- [ ] **Step 4: Run → PASS + commit**

Run: `pnpm vitest run tests/unit/sqlite-config.test.ts` (3 pass), then `pnpm typecheck && pnpm lint`.

```bash
git add src/db-host/sqlite/sqlite-config.ts tests/unit/sqlite-config.test.ts
git commit -m "feat: pure configFor(SqliteProfile) → libsql Config"
```

---

### Task 4: Injectable client factory + connect by kind

**Files:**

- Modify: `src/db-host/sqlite/sqlite-adapter.ts`, `tests/unit/sqlite-config.test.ts`

**Interfaces:**

- Consumes: `configFor` (Task 3), `@libsql/client` `createClient`/`Client`/`Config`.
- Produces: `new SqliteAdapter(makeClient?: (c: Config) => Client)`; `connect()` handles all kinds and `sync()`s replicas.

- [ ] **Step 1: Failing connect-wiring test**

Add to `tests/unit/sqlite-config.test.ts`:

```ts
import { SqliteAdapter } from '../../src/db-host/sqlite/sqlite-adapter'

describe('SqliteAdapter.connect wiring', () => {
  function fakeClient() {
    return {
      calls: [] as string[],
      execute: async () => ({ rows: [], columns: [], rowsAffected: 0 }),
      sync: async function (this: { calls: string[] }) {
        this.calls.push('sync')
      },
      close: () => {}
    }
  }
  it('passes the right config and syncs only for replica', async () => {
    const seen: unknown[] = []
    const fc = fakeClient()
    const make = (c: unknown): typeof fc => {
      seen.push(c)
      return fc
    }
    const adapter = new SqliteAdapter(make as never)
    await adapter.connect({
      id: 'x',
      name: 'x',
      engine: 'sqlite',
      kind: 'remote',
      url: 'libsql://x',
      authToken: 't'
    })
    expect(seen[0]).toEqual({ url: 'libsql://x', authToken: 't' })
    expect(fc.calls).not.toContain('sync')

    const fc2 = fakeClient()
    const adapter2 = new SqliteAdapter(((c: unknown) => (seen.push(c), fc2)) as never)
    await adapter2.connect({
      id: 'y',
      name: 'y',
      engine: 'sqlite',
      kind: 'replica',
      file: '/tmp/r.db',
      syncUrl: 'libsql://x',
      authToken: 't'
    })
    expect(fc2.calls).toContain('sync')
  })
})
```

- [ ] **Step 2: Run → FAIL** (SqliteAdapter has no ctor arg / throws for non-local)

Run: `pnpm vitest run tests/unit/sqlite-config.test.ts`.

- [ ] **Step 3: Make the factory injectable + connect by kind**

Modify `src/db-host/sqlite/sqlite-adapter.ts`:

- Import: `import { createClient, type Client, type Config, type ResultSet } from '@libsql/client'` and `import { configFor } from './sqlite-config'`.
- Add a constructor with an injectable factory:

```ts
  constructor(private readonly makeClient: (config: Config) => Client = createClient) {}
```

- Replace `connect()`:

```ts
  async connect(profile: ConnectionProfile): Promise<void> {
    if (profile.engine !== 'sqlite') throw new Error('SqliteAdapter requires a sqlite profile')
    const client = this.makeClient(configFor(profile))
    if (profile.kind === 'replica') await client.sync()
    this.client = client
  }
```

- [ ] **Step 4: Run → PASS + full verify + commit**

Run: `pnpm vitest run tests/unit/sqlite-config.test.ts`, then `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. The local SQLite contract still passes (default `createClient`).

```bash
git add src/db-host/sqlite/sqlite-adapter.ts tests/unit/sqlite-config.test.ts
git commit -m "feat: injectable libsql factory + connect by kind (sync replicas)"
```

---

### Task 5: Auth-token secret handling

**Files:**

- Modify: `src/main/secret-store.ts`, `src/main/profile-store.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/rpc.ts`

**Interfaces:**

- Produces: `StoredSecrets.authToken?`; the secrets bag (`{ password?; sshPassword?; sshPassphrase?; authToken? }`) end-to-end.

- [ ] **Step 1: SecretStore shape**

Modify `src/main/secret-store.ts` — add `authToken?: string` to `StoredSecrets`:

```ts
export interface StoredSecrets {
  password?: string
  sshPassword?: string
  sshPassphrase?: string
  authToken?: string
}
```

- [ ] **Step 2: Widen the secrets bag type at every hop**

- `src/preload/index.ts` and `src/renderer/src/rpc.ts`: change the `secrets` arg type on `profiles.save` from `{ password?: string; sshPassword?: string; sshPassphrase?: string }` to `{ password?: string; sshPassword?: string; sshPassphrase?: string; authToken?: string }`.
- `src/main/ipc.ts` `profiles:save` handler: same widening on `secretFields`, and include `authToken` in the "any secret present?" guard:

```ts
if (
  secretFields.password ||
  secretFields.sshPassword ||
  secretFields.sshPassphrase ||
  secretFields.authToken
) {
  await secrets.set(profile.id, secretFields)
}
```

- [ ] **Step 3: Strip the token before persisting**

Modify `src/main/profile-store.ts` `save()` — the secret-strip switch gains a sqlite remote/replica branch:

```ts
let safe: ConnectionProfile
if (profile.engine === 'postgres') {
  const { password: _pw, sshPassword: _sp, sshPassphrase: _pp, ...rest } = profile
  void _pw
  void _sp
  void _pp
  safe = rest
} else if (profile.kind === 'remote' || profile.kind === 'replica') {
  const { authToken: _at, ...rest } = profile
  void _at
  safe = rest
} else {
  safe = { ...profile }
}
```

- [ ] **Step 4: Inject the token on hydrate**

Modify `src/main/ipc.ts` `hydrate()` — after the postgres branch, add a sqlite remote/replica branch:

```ts
if (profile.engine === 'postgres') {
  const s = await secrets.get(id)
  return {
    ...profile,
    password: s.password,
    sshPassword: s.sshPassword,
    sshPassphrase: s.sshPassphrase
  }
}
if (profile.engine === 'sqlite' && (profile.kind === 'remote' || profile.kind === 'replica')) {
  const s = await secrets.get(id)
  return { ...profile, authToken: s.authToken }
}
return profile
```

(Replace the current `if (profile.engine !== 'postgres') return profile` early-return with this structure.)

- [ ] **Step 5: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Existing profile-store/secret-store unit tests stay green (postgres path unchanged).

```bash
git add src/main/secret-store.ts src/main/profile-store.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/rpc.ts
git commit -m "feat: route SQLite auth token through the keychain"
```

---

### Task 6: ProfileForm kind selector + remote/replica fields

**Files:**

- Modify: `src/renderer/src/components/ProfileForm.tsx`

**Interfaces:**

- Consumes: `SqliteRemote`/`SqliteReplica` (Task 1), `window.fordb.dialog.openFile`.

- [ ] **Step 1: State + kind selector**

Modify `src/renderer/src/components/ProfileForm.tsx`:

- Add state: `const [kind, setKind] = useState<'local' | 'remote' | 'replica'>(p?.engine === 'sqlite' ? p.kind : 'local')`; `const [url, setUrl] = useState(p?.engine === 'sqlite' && p.kind === 'remote' ? p.url : '')`; `const [syncUrl, setSyncUrl] = useState(p?.engine === 'sqlite' && p.kind === 'replica' ? p.syncUrl : '')`; `const [authToken, setAuthToken] = useState('')`.
- Inside the `{engine === 'sqlite' && (…)}` block, add a kind `Select` (Local file / Remote / Embedded replica) bound to `kind`, then render per kind:
  - `local`: the existing file `Input` + Browse….
  - `remote`: `url` `Input` (placeholder `"libsql:// URL"`) + `authToken` password `Input` (placeholder `"Auth token"`).
  - `replica`: file `Input` + Browse… + `syncUrl` `Input` (placeholder `"Sync URL"`) + `authToken` password `Input`.

- [ ] **Step 2: build() + secrets() per kind**

- `build()` sqlite branch returns the matching variant:

```ts
if (engine === 'sqlite') {
  const id = p?.id ?? newId()
  let base: import('@shared/adapter/types').SqliteProfile
  if (kind === 'remote') base = { id, name, engine: 'sqlite', kind: 'remote', url }
  else if (kind === 'replica') base = { id, name, engine: 'sqlite', kind: 'replica', file, syncUrl }
  else base = { id, name, engine: 'sqlite', kind: 'local', file }
  return { ...base, name: name.trim() || connectionLabel(base) }
}
```

- `secrets()`: return the token for remote/replica sqlite. Since `secrets()` currently returns PG fields, add the token conditionally:

```ts
function secrets(): {
  password?: string
  sshPassword?: string
  sshPassphrase?: string
  authToken?: string
} {
  if (engine === 'sqlite')
    return kind === 'remote' || kind === 'replica' ? { authToken: authToken || undefined } : {}
  return {
    password: password || undefined,
    sshPassword: useSsh && authMethod === 'password' ? sshPassword || undefined : undefined,
    sshPassphrase: useSsh && authMethod === 'key' ? sshPassphrase || undefined : undefined
  }
}
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

```bash
git add src/renderer/src/components/ProfileForm.tsx
git commit -m "feat: SQLite kind selector (local/remote/replica) in ProfileForm"
```

---

### Task 7: Remote contract test

**Files:**

- Create: `tests/contract/sqld-seed.ts`, `tests/contract/sqlite-remote.contract.test.ts`

**Interfaces:**

- Consumes: `SqliteAdapter`, `runAdapterContractTests` (`expected`), the seed helper.

- [ ] **Step 1: Seed helper**

`tests/contract/sqld-seed.ts` — mirrors the local SQLite fixture data into a libsql target:

```ts
import { createClient } from '@libsql/client'

const SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), amount REAL NOT NULL);
  CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders(user_id);
  CREATE VIEW IF NOT EXISTS user_emails AS SELECT id, email FROM users;
  INSERT INTO users (email, name)
  WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 1000)
  SELECT 'user' || i || '@example.com', 'User ' || i FROM seq;
  INSERT INTO orders (user_id, amount)
  WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 5000)
  SELECT ((i - 1) % 1000) + 1, (i % 500) / 10.0 FROM seq;`

/** Seeds the fixture into the sqld at `url`. Idempotent-ish: drops first so
 *  re-runs don't accumulate rows. */
export async function seedSqld(url: string): Promise<void> {
  const c = createClient({ url })
  await c.executeMultiple(
    `DROP VIEW IF EXISTS user_emails; DROP TABLE IF EXISTS orders; DROP TABLE IF EXISTS users;`
  )
  await c.executeMultiple(SQL)
  c.close()
}
```

- [ ] **Step 2: Remote contract test**

`tests/contract/sqlite-remote.contract.test.ts`:

```ts
import { beforeAll } from 'vitest'
import { runAdapterContractTests } from './adapter-contract'
import { SqliteAdapter } from '../../src/db-host/sqlite/sqlite-adapter'
import { seedSqld } from './sqld-seed'
import type { SqliteProfile } from '../../src/shared/adapter/types'

const URL = 'http://127.0.0.1:8080'
const profile: SqliteProfile = {
  id: 'sr',
  name: 'sqlite-remote',
  engine: 'sqlite',
  kind: 'remote',
  url: URL
}

beforeAll(async () => {
  await seedSqld(URL)
})

runAdapterContractTests(() => new SqliteAdapter(), profile, { database: 'main', schema: 'main' })
```

- [ ] **Step 3: Run against Docker + commit**

Run: `pnpm db:up && pnpm test:contract && pnpm db:down`. The remote SQLite contract (14 tests, cancel skipped) passes over the wire alongside Postgres + local SQLite. Then `pnpm typecheck && pnpm lint`.

```bash
git add tests/contract/sqld-seed.ts tests/contract/sqlite-remote.contract.test.ts
git commit -m "test: remote SQLite contract against sqld"
```

---

### Task 8: Replica contract test

**Files:**

- Create: `tests/contract/sqlite-replica.contract.test.ts`

**Interfaces:**

- Consumes: `SqliteAdapter`, `runAdapterContractTests`, `seedSqld`.

- [ ] **Step 1: Replica contract test**

`tests/contract/sqlite-replica.contract.test.ts`:

```ts
import { beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAdapterContractTests } from './adapter-contract'
import { SqliteAdapter } from '../../src/db-host/sqlite/sqlite-adapter'
import { seedSqld } from './sqld-seed'
import type { SqliteProfile } from '../../src/shared/adapter/types'

const SYNC_URL = 'http://127.0.0.1:8080'
// The adapter connect()s and sync()s the replica; the shared contract then
// reads the synced local snapshot.
const file = join(mkdtempSync(join(tmpdir(), 'fordb-replica-')), 'replica.sqlite')
const profile: SqliteProfile = {
  id: 'srep',
  name: 'sqlite-replica',
  engine: 'sqlite',
  kind: 'replica',
  file,
  syncUrl: SYNC_URL
}

beforeAll(async () => {
  await seedSqld(SYNC_URL)
})

runAdapterContractTests(() => new SqliteAdapter(), profile, { database: 'main', schema: 'main' })
```

- [ ] **Step 2: Run against Docker + commit**

Run: `pnpm db:up && pnpm test:contract && pnpm db:down`. The replica connects, syncs the seeded data down, and the shared contract passes against the local snapshot. All suites green (Postgres + local/remote/replica SQLite). Then `pnpm typecheck && pnpm lint && pnpm build`.

```bash
git add tests/contract/sqlite-replica.contract.test.ts
git commit -m "test: embedded-replica SQLite contract (sync then read)"
```

---

## Self-Review (done at plan time)

1. **Spec coverage:** Profile sub-union (spec §1) → Task 1 (+ legacy normalize). Secret handling (§2) → Task 5. Adapter connect-by-kind + configFor (§3) → Tasks 3–4. ProfileForm (§4) → Task 6. sqld container (§5) → Task 2. Testing (§6): configFor + connect-wiring units (3,4), remote contract (7), replica contract (8). Success criterion (three kinds connect + browse/query; token in keychain; remote/replica contract-tested) covered by 1/4/5/6/7/8.
2. **Placeholder scan:** No TBD/TODO; every code step carries full code. The only environment-dependent spot — the `sqld` healthcheck URL (Task 2 Step 1) — has an explicit "adjust if the path differs; the round-trip is the real gate" note, because the health endpoint can vary by image tag; the libsql round-trip is the pinned acceptance.
3. **Type consistency:** `SqliteLocal`/`SqliteRemote`/`SqliteReplica`/`SqliteProfile` (Task 1) used verbatim in 3/4/5/6/7/8. `configFor(profile): Config` (Task 3) consumed by the adapter (4). `new SqliteAdapter(makeClient?)` (Task 4) — default `createClient`, so the contract callers `() => new SqliteAdapter()` (7,8, and the existing local test) stay valid. Secrets bag `{…; authToken?}` consistent across secret-store/ipc/preload/rpc/ProfileForm (5,6). `kind` values `'local'|'remote'|'replica'` consistent everywhere.

**Known deliberate deferrals:** replica sync-on-connect only (no interval/manual); `sqld` no-auth so the token isn't exercised over the wire (configFor/connect-wiring unit tests cover it deterministically); no remote e2e (contract covers it); `file:` URL not escaped for exotic paths (carried from the SQLite milestone, unchanged).

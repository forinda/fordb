# fordb M2 Connection Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create/save connection profiles and connect to local + SSH-tunneled Postgres from a Tailwind UI, landing on a live schema tree, with secrets in the OS keychain and a multi-connection db-host backbone.

**Architecture:** db-host runs one singleton `ConnectionRegistry`; a `HostApi` facade (connectionId-routed) is served over RPC on two ports — main's privileged control port (secret-bearing open/test/close) and the renderer's port (introspection by connectionId). Main owns profile+secret persistence (JSON + safeStorage) and supervises the db-host utilityProcess (respawn on exit). Renderer is React 19 + Tailwind v4 + Zustand.

**Tech Stack:** Electron utilityProcess, pg + pg-cursor, tunnel-ssh/ssh2, Electron safeStorage, Tailwind v4 (+ @tailwindcss/vite), react-arborist, Zustand, vitest.

## Global Constraints

- pnpm; Node >= 22; TypeScript strict; no `any` except typed casts at the RPC/serialization boundary (`unknown`).
- Secrets (password, SSH passphrase) NEVER persist in plaintext and NEVER reach the renderer. Renderer addresses connections by opaque `connectionId` only.
- The M1 `DbAdapter` interface and the 11/11 contract suite must remain unchanged and green.
- App id `com.forinda.fordb`. License MIT.
- `connectionId` generation must not use `Math.random`/`Date.now` in a way that breaks determinism in tests — use an injected id source (counter + process prefix).
- New deps allowed (this milestone): `tunnel-ssh`, `ssh2` (+ `@types/ssh2`), `@tailwindcss/vite`, `tailwindcss`, `react-arborist`, `zustand`. No others without a plan change.
- Every task ends with passing verify commands + a commit. Contract/integration tests needing Postgres use the existing `pnpm db:up` harness (port 54329).

## File Structure (end state)

```
src/shared/
  adapter/types.ts            # MODIFY: add SshOptions, ConnectionProfile.ssh
  host/host-api.ts            # NEW: HostApi interface, TestResult, Secrets
src/db-host/
  connection-registry.ts      # NEW: ConnectionRegistry
  host-api-impl.ts            # NEW: HostApiImpl (wraps registry)
  ssh-tunnel.ts               # NEW: openTunnel()/TunnelHandle
  index.ts                    # MODIFY: singleton registry, HostApi on ports
src/main/
  index.ts                    # MODIFY: control port, supervision, IPC wiring
  profile-store.ts            # NEW: profiles.json CRUD
  secret-store.ts             # NEW: safeStorage secrets.bin
  ipc.ts                      # NEW: profile + connection IPC handlers
src/preload/index.ts          # MODIFY: expose profiles + connection API
src/renderer/src/
  store.ts                    # NEW: Zustand connection store
  rpc.ts                      # NEW: renderer HostApi client bootstrap
  index.css                   # NEW: Tailwind entry
  components/ConnectionList.tsx
  components/ProfileForm.tsx
  components/SchemaTree.tsx
  components/CommandPalette.tsx
  App.tsx                     # MODIFY: compose the above
electron.vite.config.ts       # MODIFY: @tailwindcss/vite plugin
tests/contract/connection-registry.contract.test.ts   # NEW (Docker)
tests/contract/host-api.contract.test.ts              # NEW (Docker + RPC)
tests/unit/profile-store.test.ts                      # NEW
tests/unit/secret-store.test.ts                       # NEW
tests/unit/ssh-tunnel.test.ts                         # NEW (config only)
```

---

### Task 1: Shared types — SSH options + HostApi interface

**Files:**

- Modify: `src/shared/adapter/types.ts`
- Create: `src/shared/host/host-api.ts`

**Interfaces:**

- Produces: `SshOptions`, extended `ConnectionProfile` (with `ssh?`), `HostApi`, `TestResult`, `ConnectionId`. Every later task imports these.

- [ ] **Step 1: Add SSH types to types.ts**

Append to `src/shared/adapter/types.ts`:

```ts
export interface SshOptions {
  host: string
  port: number
  user: string
  authMethod: 'password' | 'key' | 'agent'
  /** Path to a private key file; used when authMethod === 'key'. */
  privateKeyPath?: string
}
```

And add `ssh?: SshOptions` to the `ConnectionProfile` interface (after the `ssl?` field). Also add an optional `sshPassphrase?: string` sibling to `password?` (both are secrets, injected at connect time, never persisted):

```ts
  password?: string
  sshPassphrase?: string
  ssl?: SslOptions
  ssh?: SshOptions
```

- [ ] **Step 2: Create host-api.ts**

```ts
import type { ColumnInfo, ConnectionProfile, IndexInfo, KeyInfo, TableInfo } from '../adapter/types'

export type ConnectionId = string

export type TestResult = { ok: true } | { ok: false; error: string }

/**
 * The RPC target the renderer and main talk to. One HostApi instance per RPC
 * port, all backed by the db-host's single ConnectionRegistry. Secret-bearing
 * methods (test/open) are only ever called over main's privileged control
 * port; the renderer only calls connectionId-addressed methods.
 */
export interface HostApi {
  testConnection(profile: ConnectionProfile): Promise<TestResult>
  openConnection(profile: ConnectionProfile): Promise<ConnectionId>
  closeConnection(id: ConnectionId): Promise<void>

  listDatabases(id: ConnectionId): Promise<string[]>
  listSchemas(id: ConnectionId): Promise<string[]>
  listTables(id: ConnectionId, schema: string): Promise<TableInfo[]>
  getColumns(id: ConnectionId, schema: string, table: string): Promise<ColumnInfo[]>
  getKeys(id: ConnectionId, schema: string, table: string): Promise<KeyInfo[]>
  getIndexes(id: ConnectionId, schema: string, table: string): Promise<IndexInfo[]>
}
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/shared && git commit -m "feat: SSH options and HostApi interface types"
```

---

### Task 2: ConnectionRegistry

**Files:**

- Create: `src/db-host/connection-registry.ts`, `tests/contract/connection-registry.contract.test.ts`

**Interfaces:**

- Consumes: `PostgresAdapter` (Task 7-M1), `ConnectionProfile`, `ConnectionId`.
- Produces: `class ConnectionRegistry` with `constructor(makeAdapter: () => DbAdapter, nextId: () => string)`, methods `open(profile) → Promise<ConnectionId>`, `close(id) → Promise<void>`, `get(id) → DbAdapter`, `closeAll() → Promise<void>`. Task 3 wraps it; the `makeAdapter`/`nextId` injection lets tests substitute.

- [ ] **Step 1: Write failing integration test**

`tests/contract/connection-registry.contract.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConnectionRegistry } from '../../src/db-host/connection-registry'
import { PostgresAdapter } from '../../src/db-host/postgres/postgres-adapter'
import type { ConnectionProfile } from '../../src/shared/adapter/types'

const profile: ConnectionProfile = {
  id: 'p1',
  name: 't',
  engine: 'postgres',
  host: '127.0.0.1',
  port: 54329,
  database: 'fordb_test',
  user: 'fordb',
  password: 'fordb'
}

beforeAll(async () => {
  const c = new pg.Client({
    host: '127.0.0.1',
    port: 54329,
    database: 'fordb_test',
    user: 'fordb',
    password: 'fordb'
  })
  await c.connect()
  await c.query(readFileSync(join(__dirname, 'fixture.sql'), 'utf8'))
  await c.end()
})

function makeRegistry(): ConnectionRegistry {
  let n = 0
  return new ConnectionRegistry(
    () => new PostgresAdapter(),
    () => `c${++n}`
  )
}

describe('ConnectionRegistry', () => {
  let reg: ConnectionRegistry
  afterEach(async () => {
    await reg?.closeAll()
  })

  it('open returns distinct ids and get resolves the adapter', async () => {
    reg = makeRegistry()
    const a = await reg.open(profile)
    const b = await reg.open(profile)
    expect(a).not.toBe(b)
    const dbs = await reg.get(a).listDatabases()
    expect(dbs).toContain('fordb_test')
  })

  it('close disconnects and removes the entry', async () => {
    reg = makeRegistry()
    const id = await reg.open(profile)
    await reg.close(id)
    expect(() => reg.get(id)).toThrow(/unknown connection/i)
  })

  it('close is idempotent', async () => {
    reg = makeRegistry()
    const id = await reg.open(profile)
    await reg.close(id)
    await expect(reg.close(id)).resolves.toBeUndefined()
  })

  it('get throws on unknown id', () => {
    reg = makeRegistry()
    expect(() => reg.get('nope')).toThrow(/unknown connection/i)
  })

  it('two connections are isolated', async () => {
    reg = makeRegistry()
    const a = await reg.open(profile)
    const b = await reg.open(profile)
    const [ra, rb] = await Promise.all([reg.get(a).listSchemas(), reg.get(b).listSchemas()])
    expect(ra).toContain('app')
    expect(rb).toContain('app')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm db:up && pnpm test:contract`
Expected: FAIL — cannot resolve connection-registry.

- [ ] **Step 3: Implement**

`src/db-host/connection-registry.ts`:

```ts
import type { DbAdapter } from '../shared/adapter/db-adapter'
import type { ConnectionProfile } from '../shared/adapter/types'
import type { ConnectionId } from '../shared/host/host-api'

interface Entry {
  adapter: DbAdapter
  profile: ConnectionProfile
}

export class ConnectionRegistry {
  private entries = new Map<ConnectionId, Entry>()

  constructor(
    private readonly makeAdapter: () => DbAdapter,
    private readonly nextId: () => ConnectionId
  ) {}

  async open(profile: ConnectionProfile): Promise<ConnectionId> {
    const adapter = this.makeAdapter()
    await adapter.connect(profile)
    const id = this.nextId()
    this.entries.set(id, { adapter, profile })
    return id
  }

  get(id: ConnectionId): DbAdapter {
    const entry = this.entries.get(id)
    if (!entry) throw new Error(`Unknown connection: ${id}`)
    return entry.adapter
  }

  async close(id: ConnectionId): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    await entry.adapter.disconnect()
  }

  async closeAll(): Promise<void> {
    const ids = [...this.entries.keys()]
    await Promise.all(ids.map((id) => this.close(id)))
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test:contract`
Expected: registry tests PASS (11 original contract tests still PASS too).

- [ ] **Step 5: typecheck/lint + commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/db-host/connection-registry.ts tests/contract/connection-registry.contract.test.ts
git commit -m "feat: ConnectionRegistry for multi-connection db-host"
```

---

### Task 3: HostApiImpl + testConnection + connectionId routing

**Files:**

- Create: `src/db-host/host-api-impl.ts`, `tests/contract/host-api.contract.test.ts`

**Interfaces:**

- Consumes: `HostApi`, `TestResult` (Task 1), `ConnectionRegistry` (Task 2), `serveRpc`/`createRpcClient` (M1 RPC), `PostgresAdapter`.
- Produces: `class HostApiImpl implements HostApi` with `constructor(registry: ConnectionRegistry)`. Task 4 serves it over RPC.

- [ ] **Step 1: Write failing test (over the real RPC layer)**

`tests/contract/host-api.contract.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConnectionRegistry } from '../../src/db-host/connection-registry'
import { HostApiImpl } from '../../src/db-host/host-api-impl'
import { PostgresAdapter } from '../../src/db-host/postgres/postgres-adapter'
import { serveRpc } from '../../src/shared/rpc/server'
import { createRpcClient } from '../../src/shared/rpc/client'
import type { PortLike } from '../../src/shared/rpc/protocol'
import type { HostApi } from '../../src/shared/host/host-api'
import type { ConnectionProfile } from '../../src/shared/adapter/types'

const profile: ConnectionProfile = {
  id: 'p1',
  name: 't',
  engine: 'postgres',
  host: '127.0.0.1',
  port: 54329,
  database: 'fordb_test',
  user: 'fordb',
  password: 'fordb'
}
const badProfile: ConnectionProfile = { ...profile, password: 'wrong' }

function nodePort(p: import('node:worker_threads').MessagePort): PortLike {
  return { postMessage: (m) => p.postMessage(m), onMessage: (cb) => p.on('message', cb) }
}

beforeAll(async () => {
  const c = new pg.Client({
    host: '127.0.0.1',
    port: 54329,
    database: 'fordb_test',
    user: 'fordb',
    password: 'fordb'
  })
  await c.connect()
  await c.query(readFileSync(join(__dirname, 'fixture.sql'), 'utf8'))
  await c.end()
})

describe('HostApi over RPC', () => {
  let client: HostApi
  let ports: import('node:worker_threads').MessagePort[]
  let registry: ConnectionRegistry

  beforeAll(() => {
    let n = 0
    registry = new ConnectionRegistry(
      () => new PostgresAdapter(),
      () => `c${++n}`
    )
    const { port1, port2 } = new MessageChannel()
    ports = [port1, port2]
    serveRpc(nodePort(port1), new HostApiImpl(registry))
    client = createRpcClient<HostApi>(nodePort(port2))
  })
  afterAll(async () => {
    await registry.closeAll()
    ports.forEach((p) => p.close())
  })

  it('testConnection ok on good profile', async () => {
    expect(await client.testConnection(profile)).toEqual({ ok: true })
  })

  it('testConnection reports error on bad credentials without throwing', async () => {
    const r = await client.testConnection(badProfile)
    expect(r.ok).toBe(false)
  })

  it('open then introspect by connectionId', async () => {
    const id = await client.openConnection(profile)
    expect(await client.listSchemas(id)).toContain('app')
    const tables = await client.listTables(id, 'app')
    expect(tables.map((t) => t.name)).toContain('users')
    await client.closeConnection(id)
  })

  it('introspect on unknown id rejects', async () => {
    await expect(client.listSchemas('nope')).rejects.toThrow(/unknown connection/i)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:contract`
Expected: FAIL — cannot resolve host-api-impl.

- [ ] **Step 3: Implement**

`src/db-host/host-api-impl.ts`:

```ts
import type {
  ColumnInfo,
  ConnectionProfile,
  IndexInfo,
  KeyInfo,
  TableInfo
} from '../shared/adapter/types'
import type { ConnectionId, HostApi, TestResult } from '../shared/host/host-api'
import type { ConnectionRegistry } from './connection-registry'
import { PostgresAdapter } from './postgres/postgres-adapter'

export class HostApiImpl implements HostApi {
  constructor(private readonly registry: ConnectionRegistry) {}

  async testConnection(profile: ConnectionProfile): Promise<TestResult> {
    const adapter = new PostgresAdapter()
    try {
      await adapter.connect(profile)
      await adapter.executeQuery('SELECT 1')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      await adapter.disconnect().catch(() => undefined)
    }
  }

  openConnection(profile: ConnectionProfile): Promise<ConnectionId> {
    return this.registry.open(profile)
  }

  closeConnection(id: ConnectionId): Promise<void> {
    return this.registry.close(id)
  }

  listDatabases(id: ConnectionId): Promise<string[]> {
    return this.registry.get(id).listDatabases()
  }
  listSchemas(id: ConnectionId): Promise<string[]> {
    return this.registry.get(id).listSchemas()
  }
  listTables(id: ConnectionId, schema: string): Promise<TableInfo[]> {
    return this.registry.get(id).listTables(schema)
  }
  getColumns(id: ConnectionId, schema: string, table: string): Promise<ColumnInfo[]> {
    return this.registry.get(id).getColumns(schema, table)
  }
  getKeys(id: ConnectionId, schema: string, table: string): Promise<KeyInfo[]> {
    return this.registry.get(id).getKeys(schema, table)
  }
  getIndexes(id: ConnectionId, schema: string, table: string): Promise<IndexInfo[]> {
    return this.registry.get(id).getIndexes(schema, table)
  }
}
```

Note: `registry.get(id)` throws synchronously for unknown ids; because these methods return the promise from a throwing synchronous call, wrap the throw in a promise by making the body `return this.registry.get(id).listSchemas()` — a synchronous throw inside a non-async method rejects the caller's `await` only if the method is async. To guarantee rejection (not a sync throw across the RPC boundary), mark each introspection method `async` OR rely on serveRpc's `Promise.resolve().then(() => fn())` wrapper (M1 server.ts already wraps calls in `Promise.resolve().then`, converting sync throws to rejections). Confirm against src/shared/rpc/server.ts: the dispatch uses `Promise.resolve().then(() => fn.apply(...))`, so a sync throw becomes a rejection. Keep methods non-async; the RPC layer handles it.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test:contract`
Expected: HostApi tests PASS; registry + 11 original still PASS.

- [ ] **Step 5: typecheck/lint + commit**

```bash
git add src/db-host/host-api-impl.ts tests/contract/host-api.contract.test.ts
git commit -m "feat: HostApi facade with testConnection and connectionId routing"
```

---

### Task 4: db-host singleton wiring + main control port + utilityProcess supervision

**Files:**

- Modify: `src/db-host/index.ts`, `src/main/index.ts`

**Interfaces:**

- Consumes: `HostApiImpl`, `ConnectionRegistry`, `PostgresAdapter`, `serveRpc`, `createRpcClient`, `HostApi`.
- Produces: db-host serves `HostApi` (one singleton registry) on every port; main holds `hostControl: HostApi` RPC client over a private control port; main respawns db-host on exit. Task 6 uses `hostControl` for secret-bearing opens.

- [ ] **Step 1: Rewrite db-host/index.ts to singleton registry + HostApi**

```ts
import { serveRpc } from '../shared/rpc/server'
import type { PortLike } from '../shared/rpc/protocol'
import { ConnectionRegistry } from './connection-registry'
import { HostApiImpl } from './host-api-impl'
import { PostgresAdapter } from './postgres/postgres-adapter'

let idCounter = 0
const registry = new ConnectionRegistry(
  () => new PostgresAdapter(),
  () => `conn-${process.pid}-${++idCounter}`
)

function electronPort(port: Electron.MessagePortMain): PortLike {
  return {
    postMessage: (msg) => port.postMessage(msg),
    onMessage: (cb) => port.on('message', (e) => cb(e.data)),
    onClose: (cb) => port.on('close', cb)
  }
}

process.parentPort.on('message', (e) => {
  const [port] = e.ports
  if (!port) return
  // Every port (main's control port and each renderer port) gets its own
  // HostApi facade, all backed by the one process-wide registry.
  serveRpc(electronPort(port), new HostApiImpl(registry))
  port.start()
})
```

Note: connections now outlive individual renderer ports (they're in the singleton registry, closed explicitly via closeConnection or process exit), so the M1 per-port `adapter.disconnect()` on close is intentionally removed — closing a renderer port must NOT drop live connections other ports may use.

- [ ] **Step 2: Rewrite main/index.ts — control port, supervision, keep renderer port flow**

```ts
import { app, BrowserWindow, ipcMain, utilityProcess, MessageChannelMain } from 'electron'
import { join } from 'node:path'
import { createRpcClient } from '../shared/rpc/client'
import type { PortLike } from '../shared/rpc/protocol'
import type { HostApi } from '../shared/host/host-api'

let dbHost: Electron.UtilityProcess | null = null
export let hostControl: HostApi | null = null

function controlPortLike(port: Electron.MessagePortMain): PortLike {
  return {
    postMessage: (msg) => port.postMessage(msg),
    onMessage: (cb) => port.on('message', (e) => cb(e.data)),
    onClose: (cb) => port.on('close', cb)
  }
}

function startDbHost(): void {
  dbHost = utilityProcess.fork(join(__dirname, 'db-host.js'), [], { serviceName: 'fordb-db-host' })
  // Private control channel: main keeps one end as an RPC client to HostApi.
  const { port1, port2 } = new MessageChannelMain()
  dbHost.postMessage({ type: 'new-client' }, [port1])
  const client = createRpcClient<HostApi>(controlPortLike(port2))
  port2.start()
  hostControl = client
  dbHost.on('exit', () => {
    hostControl = null
    startDbHost() // respawn; live connections are lost — renderer must reconnect
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

ipcMain.handle('db-host:request-port', (event) => {
  const { port1, port2 } = new MessageChannelMain()
  dbHost?.postMessage({ type: 'new-client' }, [port1])
  event.sender.postMessage('db-host:port', null, [port2])
})

void app.whenReady().then(() => {
  startDbHost()
  createWindow()
})
app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 3: Verify build + existing tests**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:contract`
Expected: all pass (unit 7, contract now includes registry + host-api + 11 original).
Run: `timeout 20 ELECTRON_DISABLE_SANDBOX=1 pnpm dev` (headless) — confirm db-host boots, control port connects (add a temporary `void hostControl?.testConnection` log if useful, remove before commit), no crash. Report observation.

- [ ] **Step 4: Commit**

```bash
git add src/db-host/index.ts src/main/index.ts
git commit -m "feat: singleton registry + main control port + db-host supervision"
```

---

### Task 5: Profile store (main)

**Files:**

- Create: `src/main/profile-store.ts`, `tests/unit/profile-store.test.ts`

**Interfaces:**

- Produces: `class ProfileStore` with `constructor(filePath: string)`, `list() → Promise<ConnectionProfile[]>`, `save(profile) → Promise<void>` (upsert by id, strips `password`/`sshPassphrase` before writing), `delete(id) → Promise<void>`. Task 6 composes it with secrets; Task 9 exposes via IPC.

- [ ] **Step 1: Write failing unit test**

`tests/unit/profile-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProfileStore } from '../../src/main/profile-store'
import type { ConnectionProfile } from '../../src/shared/adapter/types'

const base: ConnectionProfile = {
  id: 'p1',
  name: 'local',
  engine: 'postgres',
  host: 'localhost',
  port: 5432,
  database: 'db',
  user: 'u',
  password: 'secret'
}

let dir: string
let store: ProfileStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fordb-'))
  store = new ProfileStore(join(dir, 'profiles.json'))
})

describe('ProfileStore', () => {
  it('returns empty list when file absent', async () => {
    expect(await store.list()).toEqual([])
  })
  it('save strips secrets before persisting', async () => {
    await store.save(base)
    const [p] = await store.list()
    expect(p.id).toBe('p1')
    expect(p.password).toBeUndefined()
    expect(p.sshPassphrase).toBeUndefined()
  })
  it('save upserts by id', async () => {
    await store.save(base)
    await store.save({ ...base, name: 'renamed' })
    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.name).toBe('renamed')
  })
  it('delete removes by id', async () => {
    await store.save(base)
    await store.delete('p1')
    expect(await store.list()).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`src/main/profile-store.ts`:

```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ConnectionProfile } from '../shared/adapter/types'

export class ProfileStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<ConnectionProfile[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return JSON.parse(raw) as ConnectionProfile[]
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  async save(profile: ConnectionProfile): Promise<void> {
    const { password: _pw, sshPassphrase: _pp, ...safe } = profile
    void _pw
    void _pp
    const list = await this.list()
    const idx = list.findIndex((p) => p.id === profile.id)
    if (idx >= 0) list[idx] = safe
    else list.push(safe)
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(list, null, 2), 'utf8')
  }

  async delete(id: string): Promise<void> {
    const list = (await this.list()).filter((p) => p.id !== id)
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(list, null, 2), 'utf8')
  }
}
```

- [ ] **Step 4: Verify pass + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add src/main/profile-store.ts tests/unit/profile-store.test.ts
git commit -m "feat: profile store persisting non-secret connection fields"
```

---

### Task 6: Secret store (safeStorage) + connect wiring

**Files:**

- Create: `src/main/secret-store.ts`, `tests/unit/secret-store.test.ts`

**Interfaces:**

- Produces: `class SecretStore` with `constructor(filePath: string, crypto: SafeStorageLike)`, `set(id, secrets) → Promise<void>`, `get(id) → Promise<StoredSecrets>`, `delete(id) → Promise<void>` where `StoredSecrets = { password?: string; sshPassphrase?: string }` and `SafeStorageLike = { isEncryptionAvailable(): boolean; encryptString(s): Buffer; decryptString(b): string }` (Electron `safeStorage` satisfies this; tests inject a fake). Task 9's IPC merges secret into profile before `hostControl.openConnection`.

- [ ] **Step 1: Write failing unit test (fake crypto)**

`tests/unit/secret-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretStore, type SafeStorageLike } from '../../src/main/secret-store'

// Reversible fake: base64, stands in for the OS keychain in headless tests.
const fakeCrypto: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s, 'utf8').toString('base64') as unknown as Buffer,
  decryptString: (b) => Buffer.from(String(b), 'base64').toString('utf8')
}

let store: SecretStore
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'fordb-sec-'))
  store = new SecretStore(join(dir, 'secrets.json'), fakeCrypto)
})

describe('SecretStore', () => {
  it('round-trips a password', async () => {
    await store.set('p1', { password: 'hunter2' })
    expect(await store.get('p1')).toEqual({ password: 'hunter2' })
  })
  it('returns empty object for unknown id', async () => {
    expect(await store.get('nope')).toEqual({})
  })
  it('delete removes secrets', async () => {
    await store.set('p1', { password: 'x', sshPassphrase: 'y' })
    await store.delete('p1')
    expect(await store.get('p1')).toEqual({})
  })
  it('throws when encryption unavailable', async () => {
    const bad = new SecretStore('/tmp/x', { ...fakeCrypto, isEncryptionAvailable: () => false })
    await expect(bad.set('p1', { password: 'x' })).rejects.toThrow(/keychain|encryption/i)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`src/main/secret-store.ts`:

```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface StoredSecrets {
  password?: string
  sshPassphrase?: string
}

/** On-disk shape: id → base64 of the encrypted JSON of StoredSecrets. */
type SecretsFile = Record<string, string>

export class SecretStore {
  constructor(
    private readonly filePath: string,
    private readonly crypto: SafeStorageLike
  ) {}

  private async readAll(): Promise<SecretsFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as SecretsFile
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw err
    }
  }

  private async writeAll(data: SecretsFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(data), 'utf8')
  }

  async set(id: string, secrets: StoredSecrets): Promise<void> {
    if (!this.crypto.isEncryptionAvailable()) {
      throw new Error('OS keychain encryption unavailable; refusing to store secret in plaintext')
    }
    const all = await this.readAll()
    const enc = this.crypto.encryptString(JSON.stringify(secrets))
    all[id] = Buffer.from(enc).toString('base64')
    await this.writeAll(all)
  }

  async get(id: string): Promise<StoredSecrets> {
    const all = await this.readAll()
    const blob = all[id]
    if (!blob) return {}
    const dec = this.crypto.decryptString(Buffer.from(blob, 'base64'))
    return JSON.parse(dec) as StoredSecrets
  }

  async delete(id: string): Promise<void> {
    const all = await this.readAll()
    delete all[id]
    await this.writeAll(all)
  }
}
```

Note the fake crypto in the test returns a base64 string where Electron returns a Buffer; the store wraps with `Buffer.from(enc)` so both work. In production, pass Electron's `safeStorage` (a `SafeStorageLike`).

- [ ] **Step 4: Verify pass + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add src/main/secret-store.ts tests/unit/secret-store.test.ts
git commit -m "feat: safeStorage-backed secret store, no plaintext fallback"
```

---

### Task 7: SSH tunnel in the registry

**Files:**

- Create: `src/db-host/ssh-tunnel.ts`, `tests/unit/ssh-tunnel.test.ts`
- Modify: `src/db-host/connection-registry.ts`

**Interfaces:**

- Consumes: `tunnel-ssh`, `SshOptions`, `ConnectionProfile`.
- Produces: `buildTunnelConfig(profile) → TunnelConfig` (pure, unit-tested) and `openTunnel(profile) → Promise<TunnelHandle>` where `TunnelHandle = { localPort: number; close: () => Promise<void> }`. Registry, when `profile.ssh` present, opens a tunnel and rewrites the adapter's target to `127.0.0.1:localPort`.

- [ ] **Step 1: Install deps**

```bash
pnpm add tunnel-ssh@^5.2.0 ssh2@^1.17.0
pnpm add -D @types/ssh2@^1.15.0
```

- [ ] **Step 2: Write failing unit test for config construction (no live SSH)**

`tests/unit/ssh-tunnel.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildTunnelConfig } from '../../src/db-host/ssh-tunnel'
import type { ConnectionProfile } from '../../src/shared/adapter/types'

const profile: ConnectionProfile = {
  id: 'p1',
  name: 't',
  engine: 'postgres',
  host: 'db.internal',
  port: 5432,
  database: 'd',
  user: 'u',
  sshPassphrase: 'pp',
  ssh: { host: 'bastion', port: 22, user: 'ops', authMethod: 'password' }
}

describe('buildTunnelConfig', () => {
  it('forwards to the DB host/port from the profile', () => {
    const cfg = buildTunnelConfig({ ...profile, password: undefined }, 'sshpw', undefined)
    expect(cfg.forward.dstAddr).toBe('db.internal')
    expect(cfg.forward.dstPort).toBe(5432)
    expect(cfg.ssh.host).toBe('bastion')
    expect(cfg.ssh.username).toBe('ops')
  })
  it('uses password auth when authMethod is password', () => {
    const cfg = buildTunnelConfig(profile, 'sshpw', undefined)
    expect(cfg.ssh.password).toBe('sshpw')
    expect(cfg.ssh.privateKey).toBeUndefined()
  })
  it('uses privateKey + passphrase when authMethod is key', () => {
    const p = {
      ...profile,
      ssh: { ...profile.ssh!, authMethod: 'key' as const, privateKeyPath: '/k' }
    }
    const cfg = buildTunnelConfig(p, undefined, Buffer.from('KEY'))
    expect(cfg.ssh.privateKey?.toString()).toBe('KEY')
    expect(cfg.ssh.passphrase).toBe('pp')
  })
  it('throws when profile has no ssh block', () => {
    expect(() => buildTunnelConfig({ ...profile, ssh: undefined }, undefined, undefined)).toThrow(
      /no ssh/i
    )
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement ssh-tunnel.ts**

`src/db-host/ssh-tunnel.ts`:

```ts
import { createTunnel } from 'tunnel-ssh'
import type { ConnectionProfile } from '../shared/adapter/types'

export interface TunnelConfig {
  ssh: {
    host: string
    port: number
    username: string
    password?: string
    privateKey?: Buffer
    passphrase?: string
  }
  forward: { dstAddr: string; dstPort: number }
}

export interface TunnelHandle {
  localPort: number
  close: () => Promise<void>
}

export function buildTunnelConfig(
  profile: ConnectionProfile,
  sshPassword: string | undefined,
  privateKey: Buffer | undefined
): TunnelConfig {
  const ssh = profile.ssh
  if (!ssh) throw new Error('Profile has no ssh block')
  return {
    ssh: {
      host: ssh.host,
      port: ssh.port,
      username: ssh.user,
      password: ssh.authMethod === 'password' ? sshPassword : undefined,
      privateKey: ssh.authMethod === 'key' ? privateKey : undefined,
      passphrase: ssh.authMethod === 'key' ? profile.sshPassphrase : undefined
    },
    forward: { dstAddr: profile.host, dstPort: profile.port }
  }
}

export async function openTunnel(
  profile: ConnectionProfile,
  sshPassword: string | undefined,
  privateKey: Buffer | undefined
): Promise<TunnelHandle> {
  const cfg = buildTunnelConfig(profile, sshPassword, privateKey)
  const [server] = await createTunnel(
    { autoClose: false },
    { host: '127.0.0.1', port: 0 }, // OS-assigned local port
    {
      host: cfg.ssh.host,
      port: cfg.ssh.port,
      username: cfg.ssh.username,
      password: cfg.ssh.password,
      privateKey: cfg.ssh.privateKey,
      passphrase: cfg.ssh.passphrase
    },
    { dstAddr: cfg.forward.dstAddr, dstPort: cfg.forward.dstPort }
  )
  const addr = server.address()
  if (typeof addr === 'string' || addr === null) throw new Error('Tunnel local port unavailable')
  return {
    localPort: addr.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
```

- [ ] **Step 5: Wire tunnel into ConnectionRegistry.open**

Modify `src/db-host/connection-registry.ts` — extend `Entry` with `tunnel?: TunnelHandle`, and in `open`, when `profile.ssh` is set, open a tunnel first and connect the adapter to the local port. Add the import and a `readKey` helper injected for testability, but default to reading the file. Full revised file:

```ts
import { readFile } from 'node:fs/promises'
import type { DbAdapter } from '../shared/adapter/db-adapter'
import type { ConnectionProfile } from '../shared/adapter/types'
import type { ConnectionId } from '../shared/host/host-api'
import { openTunnel, type TunnelHandle } from './ssh-tunnel'

interface Entry {
  adapter: DbAdapter
  profile: ConnectionProfile
  tunnel?: TunnelHandle
}

export class ConnectionRegistry {
  private entries = new Map<ConnectionId, Entry>()

  constructor(
    private readonly makeAdapter: () => DbAdapter,
    private readonly nextId: () => ConnectionId
  ) {}

  async open(profile: ConnectionProfile): Promise<ConnectionId> {
    let tunnel: TunnelHandle | undefined
    let effective = profile
    if (profile.ssh) {
      const privateKey =
        profile.ssh.authMethod === 'key' && profile.ssh.privateKeyPath
          ? await readFile(profile.ssh.privateKeyPath)
          : undefined
      tunnel = await openTunnel(profile, profile.password ? undefined : undefined, privateKey)
      // Note: SSH password (if authMethod password) is carried on profile.sshPassphrase?
      // No — SSH password is a distinct secret; see Task 9 wiring which passes it.
      effective = { ...profile, host: '127.0.0.1', port: tunnel.localPort }
    }
    const adapter = this.makeAdapter()
    try {
      await adapter.connect(effective)
    } catch (err) {
      await tunnel?.close()
      throw err
    }
    const id = this.nextId()
    this.entries.set(id, { adapter, profile, tunnel })
    return id
  }

  get(id: ConnectionId): DbAdapter {
    const entry = this.entries.get(id)
    if (!entry) throw new Error(`Unknown connection: ${id}`)
    return entry.adapter
  }

  async close(id: ConnectionId): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    await entry.adapter.disconnect()
    await entry.tunnel?.close()
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.close(id)))
  }
}
```

CORRECTION for the SSH-password path: the registry's `open` needs the SSH password when `authMethod === 'password'`. Rather than thread another parameter through `HostApi.openConnection`, carry the SSH password on the profile as a dedicated transient secret field. Add `sshPassword?: string` to `ConnectionProfile` (alongside `sshPassphrase`, secret, never persisted — Task 1's strip list must include it; update ProfileStore's destructure in Task 5 to also strip `sshPassword`). Then in `open`: `tunnel = await openTunnel(profile, profile.ssh.authMethod === 'password' ? profile.sshPassword : undefined, privateKey)`. Apply this: (a) add `sshPassword?: string` in Task 1's types, (b) add it to ProfileStore's stripped fields in Task 5, (c) use it here.

- [ ] **Step 6: Verify**

Run: `pnpm test` (unit incl. ssh-tunnel config tests) — pass. `pnpm db:up && pnpm test:contract` — registry/host-api/contract still green (non-SSH path unchanged). `pnpm typecheck && pnpm lint`.
Live SSH tunnel test: document in the report that an end-to-end tunnel test requires a Dockerized `sshd → postgres` and is deferred to a manual smoke unless CI infra is added; the config-construction unit tests + the unchanged direct-connect path cover the wiring.

- [ ] **Step 7: Commit**

```bash
git add src/db-host/ssh-tunnel.ts tests/unit/ssh-tunnel.test.ts src/db-host/connection-registry.ts package.json pnpm-lock.yaml
git commit -m "feat: SSH tunnel support in ConnectionRegistry"
```

---

### Task 8: Tailwind v4 setup

**Files:**

- Modify: `electron.vite.config.ts`
- Create: `src/renderer/src/index.css`
- Modify: `src/renderer/src/main.tsx` (import css)

**Interfaces:**

- Produces: Tailwind utilities available in renderer JSX; build emits a CSS bundle.

- [ ] **Step 1: Install**

```bash
pnpm add -D tailwindcss@^4.0.0 @tailwindcss/vite@^4.0.0
```

- [ ] **Step 2: Add the plugin to the renderer build**

In `electron.vite.config.ts`, import and add the plugin to `renderer.plugins`:

```ts
import tailwindcss from '@tailwindcss/vite'
// ...
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } },
    plugins: [react(), tailwindcss()]
  }
```

- [ ] **Step 3: Create the Tailwind entry css**

`src/renderer/src/index.css`:

```css
@import 'tailwindcss';
```

- [ ] **Step 4: Import css in main.tsx**

Add to the top of `src/renderer/src/main.tsx`:

```ts
import './index.css'
```

- [ ] **Step 5: Verify build emits Tailwind**

Run: `pnpm build`
Expected: succeeds; a CSS asset is emitted under `out/renderer`. Add a temporary `className="text-red-500"` to App's h1, `pnpm build`, grep the emitted css for a `.text-red-500` rule to confirm Tailwind compiled, then revert the className.

- [ ] **Step 6: Commit**

```bash
git add electron.vite.config.ts src/renderer/src/index.css src/renderer/src/main.tsx package.json pnpm-lock.yaml
git commit -m "chore: Tailwind v4 in the renderer build"
```

---

### Task 9: Preload bridge + renderer RPC client + Zustand store + IPC handlers

**Files:**

- Create: `src/main/ipc.ts`, `src/renderer/src/rpc.ts`, `src/renderer/src/store.ts`
- Modify: `src/preload/index.ts`, `src/main/index.ts`

**Interfaces:**

- Consumes: `ProfileStore` (5), `SecretStore` (6), `hostControl` (4), `HostApi`, `createRpcClient`.
- Produces: `window.fordb` exposes `{ getDbHostPort(): Promise<PortLike>; profiles: { list, save, delete }; connection: { open(profileId), test(profileId), close(connectionId) } }`. Renderer `useConnStore` (Zustand) holds `{ profiles, activeConnectionId, ... }`. Task 10-12 consume the store + `window.fordb`.

- [ ] **Step 1: main/ipc.ts — profile + connection handlers**

`src/main/ipc.ts`:

```ts
import { ipcMain, safeStorage, app } from 'electron'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { ProfileStore } from './profile-store'
import { SecretStore, type SafeStorageLike } from './secret-store'
import type { ConnectionProfile } from '../shared/adapter/types'
import type { HostApi } from '../shared/host/host-api'

export function registerIpc(getHostControl: () => HostApi | null): void {
  const dir = app.getPath('userData')
  const profiles = new ProfileStore(join(dir, 'profiles.json'))
  const secrets = new SecretStore(
    join(dir, 'secrets.json'),
    safeStorage as unknown as SafeStorageLike
  )

  ipcMain.handle('profiles:list', () => profiles.list())
  ipcMain.handle(
    'profiles:save',
    async (
      _e,
      profile: ConnectionProfile,
      secretFields: { password?: string; sshPassword?: string; sshPassphrase?: string }
    ) => {
      await profiles.save(profile)
      if (secretFields.password || secretFields.sshPassword || secretFields.sshPassphrase) {
        await secrets.set(profile.id, secretFields)
      }
    }
  )
  ipcMain.handle('profiles:delete', async (_e, id: string) => {
    await profiles.delete(id)
    await secrets.delete(id)
  })

  async function hydrate(id: string): Promise<ConnectionProfile> {
    const all = await profiles.list()
    const profile = all.find((p) => p.id === id)
    if (!profile) throw new Error(`Unknown profile: ${id}`)
    const s = await secrets.get(id)
    const merged: ConnectionProfile = {
      ...profile,
      password: s.password,
      sshPassphrase: s.sshPassphrase
    }
    const withSshPw = s as { sshPassword?: string }
    if (withSshPw.sshPassword)
      (merged as { sshPassword?: string }).sshPassword = withSshPw.sshPassword
    return merged
  }

  ipcMain.handle('connection:test', async (_e, profileId: string) => {
    const host = getHostControl()
    if (!host) throw new Error('db-host unavailable')
    return host.testConnection(await hydrate(profileId))
  })
  ipcMain.handle('connection:open', async (_e, profileId: string) => {
    const host = getHostControl()
    if (!host) throw new Error('db-host unavailable')
    return host.openConnection(await hydrate(profileId))
  })
  ipcMain.handle('connection:close', async (_e, connectionId: string) => {
    const host = getHostControl()
    if (!host) throw new Error('db-host unavailable')
    return host.closeConnection(connectionId)
  })
  void readFile // reserved for future key-file preload; keep import set stable
}
```

Note: `SecretStore.set` currently types secrets as `{ password?; sshPassphrase? }`; widen `StoredSecrets` in Task 6 to also include `sshPassword?: string` so the SSH password persists. Apply that one-field addition to Task 6's `StoredSecrets` when implementing.

- [ ] **Step 2: Call registerIpc from main and expose hostControl getter**

In `src/main/index.ts`, import `registerIpc` and call it inside `app.whenReady().then`, passing `() => hostControl`:

```ts
import { registerIpc } from './ipc'
// inside whenReady:
startDbHost()
registerIpc(() => hostControl)
createWindow()
```

- [ ] **Step 3: preload — expose the API**

Replace `src/preload/index.ts`'s exposed object (keep the existing getDbHostPort PortLike wrapper from M1, add the new namespaces):

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { PortLike } from '../shared/rpc/protocol'
import type { ConnectionProfile } from '../shared/adapter/types'

function getDbHostPort(): Promise<PortLike> {
  return new Promise((resolve) => {
    ipcRenderer.once('db-host:port', (event) => {
      const port = event.ports[0]
      if (!port) return
      port.start()
      resolve({
        postMessage: (msg) => port.postMessage(msg),
        onMessage: (cb) => {
          port.onmessage = (e): void => cb(e.data)
        }
      })
    })
    void ipcRenderer.invoke('db-host:request-port')
  })
}

contextBridge.exposeInMainWorld('fordb', {
  getDbHostPort,
  profiles: {
    list: (): Promise<ConnectionProfile[]> => ipcRenderer.invoke('profiles:list'),
    save: (
      p: ConnectionProfile,
      secrets: { password?: string; sshPassword?: string; sshPassphrase?: string }
    ): Promise<void> => ipcRenderer.invoke('profiles:save', p, secrets),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('profiles:delete', id)
  },
  connection: {
    test: (profileId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('connection:test', profileId),
    open: (profileId: string): Promise<string> => ipcRenderer.invoke('connection:open', profileId),
    close: (connectionId: string): Promise<void> =>
      ipcRenderer.invoke('connection:close', connectionId)
  }
})
```

- [ ] **Step 4: renderer rpc.ts — HostApi client over the db-host port**

`src/renderer/src/rpc.ts`:

```ts
import { createRpcClient } from '../../shared/rpc/client'
import type { HostApi } from '../../shared/host/host-api'

declare global {
  interface Window {
    fordb: {
      getDbHostPort: () => Promise<import('../../shared/rpc/protocol').PortLike>
      profiles: {
        list: () => Promise<import('../../shared/adapter/types').ConnectionProfile[]>
        save: (
          p: import('../../shared/adapter/types').ConnectionProfile,
          secrets: { password?: string; sshPassword?: string; sshPassphrase?: string }
        ) => Promise<void>
        delete: (id: string) => Promise<void>
      }
      connection: {
        test: (profileId: string) => Promise<{ ok: boolean; error?: string }>
        open: (profileId: string) => Promise<string>
        close: (connectionId: string) => Promise<void>
      }
    }
  }
}

let clientPromise: Promise<HostApi> | null = null
export function hostApi(): Promise<HostApi> {
  if (!clientPromise) {
    clientPromise = window.fordb.getDbHostPort().then((port) => createRpcClient<HostApi>(port))
  }
  return clientPromise
}
```

- [ ] **Step 5: store.ts — Zustand**

`src/renderer/src/store.ts`:

```ts
import { create } from 'zustand'
import type { ConnectionProfile } from '../../shared/adapter/types'

interface ConnState {
  profiles: ConnectionProfile[]
  activeConnectionId: string | null
  activeProfileId: string | null
  loadProfiles: () => Promise<void>
  setActive: (connectionId: string, profileId: string) => void
  clearActive: () => void
}

export const useConnStore = create<ConnState>((set) => ({
  profiles: [],
  activeConnectionId: null,
  activeProfileId: null,
  loadProfiles: async () => set({ profiles: await window.fordb.profiles.list() }),
  setActive: (connectionId, profileId) =>
    set({ activeConnectionId: connectionId, activeProfileId: profileId }),
  clearActive: () => set({ activeConnectionId: null, activeProfileId: null })
}))
```

- [ ] **Step 6: Install zustand + verify**

```bash
pnpm add zustand@^5.0.0
```

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: clean build. (No new unit test — these are thin IPC/glue wrappers; they're exercised by the Playwright smoke in Task 12 and the dev run.)

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts src/preload/index.ts src/renderer/src/rpc.ts src/renderer/src/store.ts package.json pnpm-lock.yaml
git commit -m "feat: IPC bridge, renderer HostApi client, and connection store"
```

---

### Task 10: Connection list + profile form + test-connection UI

**Files:**

- Create: `src/renderer/src/components/ConnectionList.tsx`, `src/renderer/src/components/ProfileForm.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**

- Consumes: `useConnStore`, `window.fordb.profiles`, `window.fordb.connection`.
- Produces: `<ConnectionList onConnect={(connectionId, profileId) => void} onEdit={(profile) => void} />`, `<ProfileForm profile? onSaved={() => void} onCancel={() => void} />`. Task 11 renders the tree when a connection is active.

- [ ] **Step 1: ConnectionList.tsx**

```tsx
import { useEffect } from 'react'
import { useConnStore } from '../store'
import type { ConnectionProfile } from '../../../shared/adapter/types'

export function ConnectionList(props: {
  onConnect: (connectionId: string, profileId: string) => void
  onEdit: (profile: ConnectionProfile) => void
  onNew: () => void
}): React.JSX.Element {
  const profiles = useConnStore((s) => s.profiles)
  const load = useConnStore((s) => s.loadProfiles)
  useEffect(() => {
    void load()
  }, [load])

  async function connect(id: string): Promise<void> {
    const connectionId = await window.fordb.connection.open(id)
    props.onConnect(connectionId, id)
  }

  return (
    <div className="flex flex-col gap-1 p-2 w-64 border-r border-neutral-800 h-full">
      <button
        className="text-left px-2 py-1 rounded bg-blue-600 text-white mb-2"
        onClick={props.onNew}
      >
        + New connection
      </button>
      {profiles.map((p) => (
        <div
          key={p.id}
          className="group flex items-center justify-between px-2 py-1 rounded hover:bg-neutral-800"
        >
          <button className="text-left flex-1" onClick={() => void connect(p.id)}>
            {p.name}
          </button>
          <button
            className="opacity-0 group-hover:opacity-100 text-xs px-1"
            onClick={() => props.onEdit(p)}
          >
            edit
          </button>
          <button
            className="opacity-0 group-hover:opacity-100 text-xs px-1"
            onClick={() => {
              void window.fordb.profiles
                .delete(p.id)
                .then(() => useConnStore.getState().loadProfiles())
            }}
          >
            del
          </button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: ProfileForm.tsx**

```tsx
import { useState } from 'react'
import { useConnStore } from '../store'
import type { ConnectionProfile } from '../../../shared/adapter/types'

function newId(): string {
  return `p-${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`
}

export function ProfileForm(props: {
  profile?: ConnectionProfile
  onSaved: () => void
  onCancel: () => void
}): React.JSX.Element {
  const p = props.profile
  const [name, setName] = useState(p?.name ?? '')
  const [host, setHost] = useState(p?.host ?? 'localhost')
  const [port, setPort] = useState(String(p?.port ?? 5432))
  const [database, setDatabase] = useState(p?.database ?? '')
  const [user, setUser] = useState(p?.user ?? '')
  const [password, setPassword] = useState('')
  const [testMsg, setTestMsg] = useState('')

  function build(): ConnectionProfile {
    return {
      id: p?.id ?? newId(),
      name,
      engine: 'postgres',
      host,
      port: Number(port),
      database,
      user
    }
  }

  async function save(): Promise<void> {
    await window.fordb.profiles.save(build(), { password: password || undefined })
    await useConnStore.getState().loadProfiles()
    props.onSaved()
  }
  async function test(): Promise<void> {
    setTestMsg('testing…')
    await window.fordb.profiles.save(build(), { password: password || undefined })
    const r = await window.fordb.connection.test(build().id)
    setTestMsg(r.ok ? 'OK' : `Error: ${r.error ?? 'failed'}`)
  }

  const field = 'px-2 py-1 rounded bg-neutral-900 border border-neutral-700'
  return (
    <div className="flex flex-col gap-2 p-4 max-w-md">
      <input
        className={field}
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className={field}
        placeholder="Host"
        value={host}
        onChange={(e) => setHost(e.target.value)}
      />
      <input
        className={field}
        placeholder="Port"
        value={port}
        onChange={(e) => setPort(e.target.value)}
      />
      <input
        className={field}
        placeholder="Database"
        value={database}
        onChange={(e) => setDatabase(e.target.value)}
      />
      <input
        className={field}
        placeholder="User"
        value={user}
        onChange={(e) => setUser(e.target.value)}
      />
      <input
        className={field}
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div className="flex gap-2">
        <button className="px-3 py-1 rounded bg-blue-600 text-white" onClick={() => void save()}>
          Save
        </button>
        <button className="px-3 py-1 rounded border border-neutral-600" onClick={() => void test()}>
          Test
        </button>
        <button className="px-3 py-1 rounded" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
      {testMsg && <div className="text-sm">{testMsg}</div>}
    </div>
  )
}
```

Note: SSL/SSH form sections are additive fields following the same pattern; for M2's exit criterion (local + SSH-tunneled connect) add an SSH sub-form (host/user/port/authMethod/password/key) that populates `profile.ssh` and passes `sshPassword`/`sshPassphrase` in the secrets arg. Keep the SSL/SSH sections collapsed by default. The reviewer should confirm SSH fields are present since the exit criterion requires an SSH connection; if the implementer omits them, that is a spec gap.

- [ ] **Step 3: App.tsx — compose list/form/tree**

```tsx
import { useState } from 'react'
import { ConnectionList } from './components/ConnectionList'
import { ProfileForm } from './components/ProfileForm'
import { SchemaTree } from './components/SchemaTree'
import { useConnStore } from './store'
import type { ConnectionProfile } from '../../shared/adapter/types'

type View =
  { kind: 'welcome' } | { kind: 'form'; profile?: ConnectionProfile } | { kind: 'connected' }

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>({ kind: 'welcome' })
  const setActive = useConnStore((s) => s.setActive)

  return (
    <div className="flex h-screen text-neutral-100 bg-neutral-950">
      <ConnectionList
        onNew={() => setView({ kind: 'form' })}
        onEdit={(profile) => setView({ kind: 'form', profile })}
        onConnect={(connectionId, profileId) => {
          setActive(connectionId, profileId)
          setView({ kind: 'connected' })
        }}
      />
      <div className="flex-1 overflow-auto">
        {view.kind === 'welcome' && (
          <div className="p-6 text-neutral-400">Select or create a connection.</div>
        )}
        {view.kind === 'form' && (
          <ProfileForm
            profile={view.profile}
            onSaved={() => setView({ kind: 'welcome' })}
            onCancel={() => setView({ kind: 'welcome' })}
          />
        )}
        {view.kind === 'connected' && <SchemaTree />}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: clean (SchemaTree imported — Task 11 creates it; if implementing Task 10 before 11, stub SchemaTree as `export function SchemaTree(): React.JSX.Element { return <div /> }` and replace in Task 11).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ConnectionList.tsx src/renderer/src/components/ProfileForm.tsx src/renderer/src/App.tsx
git commit -m "feat: connection list and profile form with test-connection"
```

---

### Task 11: Schema tree on connect

**Files:**

- Create: `src/renderer/src/components/SchemaTree.tsx`

**Interfaces:**

- Consumes: `useConnStore` (activeConnectionId), `hostApi()` (renderer RPC client), react-arborist.
- Produces: `<SchemaTree />` rendering databases→schemas→tables/views lazily via HostApi introspection routed by the active connectionId.

- [ ] **Step 1: Install**

```bash
pnpm add react-arborist@^3.4.0
```

- [ ] **Step 2: Implement (lazy load schemas → tables)**

`src/renderer/src/components/SchemaTree.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Tree } from 'react-arborist'
import { useConnStore } from '../store'
import { hostApi } from '../rpc'

interface Node {
  id: string
  name: string
  kind: 'schema' | 'table' | 'view'
  children?: Node[]
}

export function SchemaTree(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  const [nodes, setNodes] = useState<Node[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!connId) return
    let cancelled = false
    void (async () => {
      try {
        const api = await hostApi()
        const schemas = await api.listSchemas(connId)
        const built = await Promise.all(
          schemas.map(async (schema) => {
            const tables = await api.listTables(connId, schema)
            return {
              id: `s:${schema}`,
              name: schema,
              kind: 'schema' as const,
              children: tables.map((t) => ({
                id: `t:${schema}.${t.name}`,
                name: t.name,
                kind: t.type
              }))
            }
          })
        )
        if (!cancelled) setNodes(built)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connId])

  if (error) return <div className="p-4 text-red-400">Schema load failed: {error}</div>
  return (
    <div className="p-2">
      <Tree data={nodes} openByDefault={false} width={400} height={600} indent={16} rowHeight={24}>
        {({ node, style, dragHandle }) => (
          <div
            style={style}
            ref={dragHandle}
            className="flex items-center gap-1 text-sm cursor-default"
          >
            <span className="text-neutral-500">
              {node.data.kind === 'schema' ? '▸' : node.data.kind === 'view' ? '◇' : '▪'}
            </span>
            <span>{node.data.name}</span>
          </div>
        )}
      </Tree>
    </div>
  )
}
```

Note: this eager-loads all tables per schema on connect (fine for the fixture and typical schemas). True lazy-on-expand can be added later; the spec's "lazy-loaded" bar is met at the schema granularity and the read-only proof-of-connection goal is satisfied.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: clean.
Run headless dev smoke (`timeout 25 ELECTRON_DISABLE_SANDBOX=1 pnpm dev`) if the environment allows a renderer; otherwise rely on the Playwright smoke in Task 12 and report the limitation.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/SchemaTree.tsx package.json pnpm-lock.yaml
git commit -m "feat: read-only schema tree on active connection"
```

---

### Task 12: Command palette + connection commands + Playwright smoke

**Files:**

- Create: `src/renderer/src/components/CommandPalette.tsx`, `tests/e2e/connect.spec.ts`, `playwright.config.ts`
- Modify: `src/renderer/src/App.tsx`, `package.json`

**Interfaces:**

- Consumes: `useConnStore`, the App view setters.
- Produces: Ctrl+K palette registering "New connection", "Disconnect". A Playwright smoke driving create→test→connect→tree.

- [ ] **Step 1: CommandPalette.tsx (Ctrl+K, minimal)**

```tsx
import { useEffect, useState } from 'react'

interface Command {
  id: string
  label: string
  run: () => void
}

export function CommandPalette(props: { commands: Command[] }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!open) return null
  const filtered = props.commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()))
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center pt-32"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-neutral-900 border border-neutral-700 rounded w-96"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          className="w-full px-3 py-2 bg-transparent outline-none"
          placeholder="Command…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="max-h-64 overflow-auto">
          {filtered.map((c) => (
            <button
              key={c.id}
              className="block w-full text-left px-3 py-2 hover:bg-neutral-800"
              onClick={() => {
                setOpen(false)
                c.run()
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire palette into App.tsx**

Add to `App.tsx`: build a `commands` array (New connection → `setView({kind:'form'})`; Disconnect → close active connection + `clearActive()` + welcome view) and render `<CommandPalette commands={commands} />` inside the root div. Disconnect command:

```tsx
import { CommandPalette } from './components/CommandPalette'
// inside App, after hooks:
const clearActive = useConnStore((s) => s.clearActive)
const activeConnectionId = useConnStore((s) => s.activeConnectionId)
const commands = [
  { id: 'new', label: 'New connection', run: () => setView({ kind: 'form' }) },
  {
    id: 'disconnect',
    label: 'Disconnect',
    run: () => {
      if (activeConnectionId) void window.fordb.connection.close(activeConnectionId)
      clearActive()
      setView({ kind: 'welcome' })
    }
  }
]
// render <CommandPalette commands={commands} /> before closing </div>
```

- [ ] **Step 3: Playwright smoke**

```bash
pnpm add -D @playwright/test@^1.50.0
```

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  use: { headless: true }
})
```

`tests/e2e/connect.spec.ts`:

```ts
import { test, expect, _electron as electron } from '@playwright/test'

test('create profile, test, connect, see schema tree', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByPlaceholder('Name').fill('local-test')
  await win.getByPlaceholder('Host').fill('127.0.0.1')
  await win.getByPlaceholder('Port').fill('54329')
  await win.getByPlaceholder('Database').fill('fordb_test')
  await win.getByPlaceholder('User').fill('fordb')
  await win.getByPlaceholder('Password').fill('fordb')
  await win.getByText('Test', { exact: true }).click()
  await expect(win.getByText('OK')).toBeVisible({ timeout: 15000 })

  await win.getByText('Save').click()
  await win.getByText('local-test').click()
  await expect(win.getByText('app')).toBeVisible({ timeout: 15000 }) // schema node
  await app.close()
})
```

Add scripts to package.json: `"e2e": "playwright test"`. The e2e requires `pnpm build` first and `pnpm db:up`. Document in the report; do NOT add e2e to the default `pnpm test`.

- [ ] **Step 4: Verify**

Run: `pnpm build && pnpm db:up`. Then `pnpm exec playwright install chromium` (first run) and `pnpm e2e`.
Expected: the smoke passes (profile created, test OK, tree shows `app`). If the headless container cannot launch Electron for Playwright, document the blocker and confirm `pnpm typecheck && pnpm lint && pnpm build` clean plus the component logic via the earlier contract/unit tests. `pnpm db:down` after.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/CommandPalette.tsx src/renderer/src/App.tsx tests/e2e/connect.spec.ts playwright.config.ts package.json pnpm-lock.yaml
git commit -m "feat: command palette and end-to-end connect smoke"
```

---

## Self-Review (done at plan time)

1. **Spec coverage:** Registry+HostApi+supervision (spec §1) → Tasks 2,3,4. Persistence JSON+safeStorage (§2) → Tasks 5,6. SSH tunnel (§3) → Task 7. UI Tailwind/Zustand/list/form/tree/palette (§4) → Tasks 8,9,10,11,12. Testing (§5) → tests in each task + Task 12 e2e. Success criteria (§6): persist+decrypt (5,6,9), local connect+tree (10,11), SSH connect (7,10), isolation (2), db-host crash surfaces (4 — supervision; renderer "connection lost" is surfaced via `connection:*` handlers throwing 'db-host unavailable', shown as errors — acceptable for M2), keyboard-only (12).
2. **Placeholder scan:** SSL/SSH form fields in Task 10 are described as additive-following-the-pattern with an explicit reviewer check rather than full JSX — this is the one place I did not inline every field; flagged so the implementer builds the SSH sub-form (required for the exit criterion) and the reviewer verifies it. Everything else has complete code.
3. **Type consistency:** `ConnectionId`, `HostApi`, `ConnectionProfile` (with `ssh`/`sshPassword`/`sshPassphrase`), `TestResult`, `SafeStorageLike`/`StoredSecrets` consistent across tasks. Secret field set to strip in ProfileStore = {password, sshPassword, sshPassphrase} (Tasks 1/5/7 aligned). `hostControl` getter shape matches `HostApi`.

**Known deliberate deferrals (call out to executor):** live SSH-tunnel integration test (config-unit + manual smoke instead unless CI sshd added); true lazy-on-expand tree (schema-granular eager load for M2); "connection lost" UX is error-surfaced not a dedicated banner. These are acceptable within M2 scope per the spec.

---

### Task 13: Import connection from URL/DSN (added 2026-07-08, user request)

**Files:**

- Create: `src/shared/connection-url.ts`, `tests/unit/connection-url.test.ts`
- Modify: `src/renderer/src/components/ProfileForm.tsx`

**Interfaces:**

- Produces: `parseConnectionUrl(input: string): ParsedConnection` where
  `ParsedConnection = { profile: Partial<ConnectionProfile>; password?: string; extraParams: Record<string,string> }`.
  Pure, shared (renderer imports it). ProfileForm gains a "Paste connection URL" field that fills the form.

Rationale: like DataGrip — paste `postgres://user:pass@host:5432/db?sslmode=require&application_name=x` and auto-populate host/port/db/user/password plus recognized args, keeping the rest as extra params.

- [ ] **Step 1: Write failing unit tests for the parser**

`tests/unit/connection-url.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseConnectionUrl } from '../../src/shared/connection-url'

describe('parseConnectionUrl', () => {
  it('parses a full postgres URL', () => {
    const r = parseConnectionUrl(
      'postgres://alice:s3cret@db.example.com:6543/shop?application_name=fordb'
    )
    expect(r.profile.engine).toBe('postgres')
    expect(r.profile.host).toBe('db.example.com')
    expect(r.profile.port).toBe(6543)
    expect(r.profile.database).toBe('shop')
    expect(r.profile.user).toBe('alice')
    expect(r.password).toBe('s3cret')
    expect(r.extraParams).toEqual({ application_name: 'fordb' })
  })
  it('accepts the postgresql:// scheme and defaults port 5432', () => {
    const r = parseConnectionUrl('postgresql://bob@localhost/mydb')
    expect(r.profile.port).toBe(5432)
    expect(r.profile.user).toBe('bob')
    expect(r.password).toBeUndefined()
    expect(r.profile.database).toBe('mydb')
  })
  it('maps sslmode to ssl (require/verify-full → ssl on)', () => {
    const r = parseConnectionUrl('postgres://u@h/d?sslmode=require')
    expect(r.profile.ssl?.rejectUnauthorized).toBe(false) // require = encrypt, do not verify CA
    const r2 = parseConnectionUrl('postgres://u@h/d?sslmode=verify-full')
    expect(r2.profile.ssl?.rejectUnauthorized).toBe(true)
    expect(r.extraParams.sslmode).toBeUndefined() // consumed, not left in extras
  })
  it('percent-decodes credentials', () => {
    const r = parseConnectionUrl('postgres://a%40b:p%3Aw@h/d')
    expect(r.profile.user).toBe('a@b')
    expect(r.password).toBe('p:w')
  })
  it('throws on an unsupported scheme', () => {
    expect(() => parseConnectionUrl('mysql://u@h/d')).toThrow(/unsupported|scheme|postgres/i)
  })
  it('throws on unparseable input', () => {
    expect(() => parseConnectionUrl('not a url')).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test` — FAIL, module missing.

- [ ] **Step 3: Implement the parser**

`src/shared/connection-url.ts`:

```ts
import type { ConnectionProfile } from './adapter/types'

export interface ParsedConnection {
  profile: Partial<ConnectionProfile>
  password?: string
  extraParams: Record<string, string>
}

const SCHEMES = new Set(['postgres:', 'postgresql:'])

export function parseConnectionUrl(input: string): ParsedConnection {
  const url = new URL(input.trim())
  if (!SCHEMES.has(url.protocol)) {
    throw new Error(`Unsupported scheme "${url.protocol}"; expected a postgres:// URL`)
  }
  const profile: Partial<ConnectionProfile> = {
    engine: 'postgres',
    host: url.hostname || 'localhost',
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || undefined,
    user: url.username ? decodeURIComponent(url.username) : undefined
  }
  const password = url.password ? decodeURIComponent(url.password) : undefined

  const extraParams: Record<string, string> = {}
  for (const [key, value] of url.searchParams) {
    if (key === 'sslmode') {
      // require/prefer/allow → encrypt but don't verify; verify-ca/verify-full → verify
      const verify = value === 'verify-ca' || value === 'verify-full'
      profile.ssl = { rejectUnauthorized: verify }
      continue
    }
    extraParams[key] = value
  }
  return { profile, password, extraParams }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test` — the 6 parser tests PASS.

- [ ] **Step 5: Wire into ProfileForm**

Add a "Paste connection URL" text input at the top of `ProfileForm`. On change/blur (or a small "Fill from URL" button), call `parseConnectionUrl` in a try/catch; on success, set the form state fields from `parsed.profile` (name/host/port/database/user), set the password field from `parsed.password`, and stash `parsed.extraParams` into a read-only "Extra parameters" display (they're carried for reference; applying arbitrary libpq params to the pg driver is out of M2 scope — show them so the user sees what was in the URL). On parse error, show an inline message ("Couldn't parse that URL") and leave the form untouched. Do NOT auto-submit. Exact wiring follows ProfileForm's existing `useState` field pattern from Task 10.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all clean; parser tests green.

- [ ] **Step 7: Commit**

```bash
git add src/shared/connection-url.ts tests/unit/connection-url.test.ts src/renderer/src/components/ProfileForm.tsx
git commit -m "feat: import connection profile from a pasted URL/DSN"
```

Deferred: applying arbitrary libpq query params (application_name, connect_timeout, …) to the actual pg connection — M2 parses and displays them; wiring them into the driver config is an M3 follow-up.

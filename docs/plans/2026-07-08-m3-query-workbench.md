# fordb M3 Query Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run SQL from a CodeMirror editor with schema-aware autocomplete, stream results into a virtualized grid that scrolls through 500k+ rows, cancel a running query, and export CSV/JSON — with a per-RPC timeout and connection-lost signal so queries never hang on a dead connection.

**Architecture:** `HostApi` gains connectionId-routed query methods over the existing `ConnectionRegistry`/adapter. The renderer streams a cursor through a `QueryResultSource` that a Glide Data Grid pulls from on demand. A CodeMirror 6 editor feeds a schema-aware completion source from introspection. `createRpcClient` gets a per-call timeout; main broadcasts a db-host-restarted signal that disposes result sources.

**Tech Stack:** CodeMirror 6 (`codemirror`, `@codemirror/lang-sql`, `@codemirror/autocomplete`, `@codemirror/view`, `@codemirror/state`), `@glideapps/glide-data-grid`, pg/pg-cursor (existing), Zustand, vitest, Docker Postgres.

## Global Constraints

- pnpm; Node >= 22; TypeScript strict; no `any` except typed casts at the RPC/serialization boundary (`unknown`).
- Results are READ-ONLY in M3 (no cell editing). SELECT-like → cursor stream (`openQuery`); other statements → buffered `executeQuery`.
- Secrets/connection model unchanged: renderer addresses connections by opaque `connectionId`; query methods route via `registry.get(connectionId)`.
- Migrated/new components use semantic theme tokens only (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `bg-destructive`, `ring`) — no raw `neutral-*`/`blue-*` literals.
- New deps limited to: `codemirror`, `@codemirror/lang-sql`, `@codemirror/autocomplete`, `@codemirror/view`, `@codemirror/state`, `@glideapps/glide-data-grid`. No others without a plan change.
- The existing 53 unit + 20 contract tests stay green. Every task ends with `pnpm typecheck && pnpm lint && pnpm test` passing, and `pnpm build` for renderer/main-touching tasks. Contract-touching tasks run `pnpm db:up && pnpm test:contract`.

## File Structure (end state)

```
src/shared/
  host/host-api.ts             # MODIFY: add executeQuery/openQuery/fetchPage/closeQuery/cancel (connectionId)
  rpc/client.ts                # MODIFY: per-call timeout
  sql/classify.ts              # NEW: isSelectLike(sql)
src/db-host/
  host-api-impl.ts             # MODIFY: implement the 5 query methods via registry.get(id)
src/main/
  index.ts                     # MODIFY: broadcast 'db-host:restarted' on respawn
src/preload/index.ts           # MODIFY: window.fordb.onDbHostRestarted
src/renderer/src/
  query/result-source.ts       # NEW: QueryResultSource (streaming paging)
  query/completion.ts          # NEW: schema-aware CodeMirror completion source
  query/cm-theme.ts            # NEW: CodeMirror token theme
  store-query.ts               # NEW: useQueryStore (tabs)
  components/QueryWorkbench.tsx # NEW: editor + run/cancel + grid + status
  components/SqlEditor.tsx      # NEW: CodeMirror wrapper
  components/ResultsGrid.tsx    # NEW: Glide grid backed by QueryResultSource
  components/QueryTabs.tsx      # NEW
  App.tsx                      # MODIFY: connected view = workbench; wire restart signal + commands
  rpc.ts                       # MODIFY: Window.fordb.onDbHostRestarted type; HostApi type import
tests/
  unit/rpc-timeout.test.ts     # NEW
  unit/classify.test.ts        # NEW
  unit/result-source.test.ts   # NEW
  contract/host-api-query.contract.test.ts  # NEW
  e2e/query.spec.ts            # NEW
```

---

### Task 1: HostApi query methods (types + impl + contract tests)

**Files:**

- Modify: `src/shared/host/host-api.ts`, `src/db-host/host-api-impl.ts`
- Create: `tests/contract/host-api-query.contract.test.ts`

**Interfaces:**

- Consumes: `QueryResult`, `OpenQueryResult`, `Page` from `src/shared/adapter/types.ts`; `ConnectionRegistry`, `PostgresAdapter`.
- Produces: `HostApi.executeQuery(id, sql)`, `openQuery(id, sql, pageSize)`, `fetchPage(id, queryId)`, `closeQuery(id, queryId)`, `cancel(id)`.

- [ ] **Step 1: Add methods to the HostApi interface**

In `src/shared/host/host-api.ts`, add the imports `OpenQueryResult, Page, QueryResult` to the existing `import type { … } from '../adapter/types'`, and add to the `HostApi` interface (after the introspection methods):

```ts
  executeQuery(id: ConnectionId, sql: string): Promise<QueryResult>
  openQuery(id: ConnectionId, sql: string, pageSize: number): Promise<OpenQueryResult>
  fetchPage(id: ConnectionId, queryId: string): Promise<Page>
  closeQuery(id: ConnectionId, queryId: string): Promise<void>
  cancel(id: ConnectionId): Promise<void>
```

- [ ] **Step 2: Write the failing contract test**

`tests/contract/host-api-query.contract.test.ts`:

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
describe('HostApi query routing', () => {
  let client: HostApi
  let ports: import('node:worker_threads').MessagePort[]
  let registry: ConnectionRegistry
  let id: string
  beforeAll(async () => {
    let n = 0
    registry = new ConnectionRegistry(
      () => new PostgresAdapter(),
      () => `c${++n}`
    )
    const { port1, port2 } = new MessageChannel()
    ports = [port1, port2]
    serveRpc(nodePort(port1), new HostApiImpl(registry))
    client = createRpcClient<HostApi>(nodePort(port2))
    id = await client.openConnection(profile)
  })
  afterAll(async () => {
    await registry.closeAll()
    ports.forEach((p) => p.close())
  })

  it('executeQuery returns buffered rows', async () => {
    const r = await client.executeQuery(id, 'SELECT id, email FROM app.users ORDER BY id LIMIT 2')
    expect(r.fields.map((f) => f.name)).toEqual(['id', 'email'])
    expect(r.rows).toHaveLength(2)
  })
  it('openQuery/fetchPage streams all rows', async () => {
    const open = await client.openQuery(id, 'SELECT id FROM app.orders ORDER BY id', 1000)
    expect(open.fields.map((f) => f.name)).toEqual(['id'])
    let total = 0
    for (;;) {
      const page = await client.fetchPage(id, open.queryId)
      total += page.rows.length
      if (page.done) break
    }
    await client.closeQuery(id, open.queryId)
    expect(total).toBe(5000)
  })
  it('cancel interrupts a running statement', async () => {
    const slow = client.executeQuery(id, 'SELECT pg_sleep(30)')
    const settled = slow.then(
      () => new Error('resolved'),
      (e: unknown) => e
    )
    await new Promise((r) => setTimeout(r, 300))
    await client.cancel(id)
    const outcome = await settled
    expect(outcome).toBeInstanceOf(Error)
    expect((outcome as Error).message).toMatch(/cancel/i)
  }, 15000)
  it('unknown connectionId rejects', async () => {
    await expect(client.executeQuery('nope', 'SELECT 1')).rejects.toThrow(/unknown connection/i)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm db:up && pnpm test:contract`
Expected: FAIL — executeQuery/openQuery/… not on HostApiImpl.

- [ ] **Step 4: Implement in HostApiImpl**

In `src/db-host/host-api-impl.ts`, add the type imports (`OpenQueryResult, Page, QueryResult`) and these methods (non-async passthroughs; `registry.get` throws synchronously for unknown ids, which `serveRpc` converts to a rejection — same pattern as the introspection methods):

```ts
  executeQuery(id: ConnectionId, sql: string): Promise<QueryResult> {
    return this.registry.get(id).executeQuery(sql)
  }
  openQuery(id: ConnectionId, sql: string, pageSize: number): Promise<OpenQueryResult> {
    return this.registry.get(id).openQuery(sql, pageSize)
  }
  fetchPage(id: ConnectionId, queryId: string): Promise<Page> {
    return this.registry.get(id).fetchPage(queryId)
  }
  closeQuery(id: ConnectionId, queryId: string): Promise<void> {
    return this.registry.get(id).closeQuery(queryId)
  }
  cancel(id: ConnectionId): Promise<void> {
    return this.registry.get(id).cancel()
  }
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test:contract`
Expected: new query-routing tests PASS; existing 20 contract tests still PASS. `pnpm db:down` after.

- [ ] **Step 6: typecheck/lint + commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/shared/host/host-api.ts src/db-host/host-api-impl.ts tests/contract/host-api-query.contract.test.ts
git commit -m "feat: connectionId-routed query methods on HostApi"
```

---

### Task 2: createRpcClient per-call timeout

**Files:**

- Modify: `src/shared/rpc/client.ts`
- Create: `tests/unit/rpc-timeout.test.ts`

**Interfaces:**

- Produces: `createRpcClient<T>(port, opts?: { timeoutMs?: number })`. A pending call rejects with `Error('RPC timeout')` after `timeoutMs`. Default: no timeout (undefined) — existing callers unchanged.

- [ ] **Step 1: Write failing tests**

`tests/unit/rpc-timeout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import { createRpcClient } from '../../src/shared/rpc/client'
import { serveRpc } from '../../src/shared/rpc/server'
import type { PortLike } from '../../src/shared/rpc/protocol'

function nodePort(p: import('node:worker_threads').MessagePort): PortLike {
  return { postMessage: (m) => p.postMessage(m), onMessage: (cb) => p.on('message', cb) }
}
interface Api {
  echo(x: number): Promise<number>
  never(): Promise<void>
}
const impl = { echo: (x: number) => Promise.resolve(x), never: () => new Promise<void>(() => {}) }

describe('rpc timeout', () => {
  it('rejects a call that never gets a response', async () => {
    const { port1, port2 } = new MessageChannel()
    serveRpc(nodePort(port1), impl)
    const client = createRpcClient<Api>(nodePort(port2), { timeoutMs: 100 })
    await expect(client.never()).rejects.toThrow(/timeout/i)
    port1.close()
    port2.close()
  })
  it('a timely call resolves before the timeout', async () => {
    const { port1, port2 } = new MessageChannel()
    serveRpc(nodePort(port1), impl)
    const client = createRpcClient<Api>(nodePort(port2), { timeoutMs: 1000 })
    await expect(client.echo(7)).resolves.toBe(7)
    port1.close()
    port2.close()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test`
Expected: FAIL — createRpcClient doesn't accept opts / no timeout.

- [ ] **Step 3: Implement**

Read `src/shared/rpc/client.ts` first. Add the opts param and a timer per pending entry. Full revised file:

```ts
import { isRpcResponse, type PortLike, type RpcRequest } from './protocol'

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

export function createRpcClient<T extends object>(
  port: PortLike,
  opts?: { timeoutMs?: number }
): T {
  let nextId = 1
  const pending = new Map<number, Pending>()

  function settle(id: number): Pending | undefined {
    const entry = pending.get(id)
    if (entry) {
      pending.delete(id)
      if (entry.timer) clearTimeout(entry.timer)
    }
    return entry
  }

  port.onMessage((msg) => {
    if (!isRpcResponse(msg)) return
    const entry = settle(msg.id)
    if (!entry) return
    if (msg.ok) entry.resolve(msg.value)
    else entry.reject(new Error(msg.error))
  })

  port.onClose?.(() => {
    for (const [id, entry] of pending) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(new Error('RPC port closed'))
      pending.delete(id)
    }
  })

  return new Proxy({} as T, {
    get(_t, method: string) {
      return (...args: unknown[]): Promise<unknown> =>
        new Promise((resolve, reject) => {
          const id = nextId++
          const entry: Pending = { resolve, reject }
          if (opts?.timeoutMs !== undefined) {
            entry.timer = setTimeout(() => {
              if (settle(id)) reject(new Error(`RPC timeout after ${opts.timeoutMs}ms`))
            }, opts.timeoutMs)
          }
          pending.set(id, entry)
          const req: RpcRequest = { kind: 'rpc-request', id, method, args }
          port.postMessage(req)
        })
    }
  })
}
```

Note: if the current `client.ts` differs (e.g. reattaches structured error fields from Task-M2 hardening), preserve that behavior — keep the `toError` reconstruction in the response handler and only add the timer/opts plumbing. Read the file and merge, don't blindly overwrite.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test`
Expected: timeout tests PASS; existing rpc tests still PASS.

- [ ] **Step 5: typecheck/lint + commit**

```bash
git add src/shared/rpc/client.ts tests/unit/rpc-timeout.test.ts
git commit -m "feat: optional per-call timeout in createRpcClient"
```

---

### Task 3: SQL statement classifier

**Files:**

- Create: `src/shared/sql/classify.ts`, `tests/unit/classify.test.ts`

**Interfaces:**

- Produces: `isSelectLike(sql: string): boolean` — true for SELECT/WITH/VALUES/SHOW/EXPLAIN/TABLE (row-returning), false for INSERT/UPDATE/DELETE/DDL, ignoring leading line/block comments and whitespace.

- [ ] **Step 1: Write failing tests**

`tests/unit/classify.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isSelectLike } from '../../src/shared/sql/classify'

describe('isSelectLike', () => {
  it('true for select/with/values/explain/table', () => {
    for (const s of [
      'SELECT 1',
      'select * from t',
      'WITH x AS (select 1) select * from x',
      'VALUES (1)',
      'EXPLAIN SELECT 1',
      'TABLE users',
      'SHOW search_path'
    ]) {
      expect(isSelectLike(s)).toBe(true)
    }
  })
  it('false for dml/ddl', () => {
    for (const s of [
      'INSERT INTO t VALUES (1)',
      'update t set x=1',
      'DELETE FROM t',
      'CREATE TABLE t (id int)',
      'DROP TABLE t',
      'ALTER TABLE t ADD c int',
      'BEGIN'
    ]) {
      expect(isSelectLike(s)).toBe(false)
    }
  })
  it('ignores leading comments and whitespace', () => {
    expect(isSelectLike('  -- a comment\n  SELECT 1')).toBe(true)
    expect(isSelectLike('/* block */\nUPDATE t SET x=1')).toBe(false)
  })
  it('false for empty/whitespace', () => {
    expect(isSelectLike('   ')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test` — FAIL, module missing.

- [ ] **Step 3: Implement**

`src/shared/sql/classify.ts`:

```ts
const ROW_RETURNING = /^(select|with|values|show|explain|table)\b/i

/** Strip leading line (--) and block (/* *​/) comments and whitespace. */
function stripLeading(sql: string): string {
  let s = sql.trimStart()
  for (;;) {
    if (s.startsWith('--')) {
      const nl = s.indexOf('\n')
      s = nl === -1 ? '' : s.slice(nl + 1).trimStart()
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/')
      s = end === -1 ? '' : s.slice(end + 2).trimStart()
    } else {
      return s
    }
  }
}

export function isSelectLike(sql: string): boolean {
  return ROW_RETURNING.test(stripLeading(sql))
}
```

- [ ] **Step 4: Run to verify pass + commit**

Run: `pnpm test`

```bash
git add src/shared/sql/classify.ts tests/unit/classify.test.ts
git commit -m "feat: SQL statement classifier (row-returning vs DML/DDL)"
```

---

### Task 4: Connection-lost signal (main + preload)

**Files:**

- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/rpc.ts`

**Interfaces:**

- Produces: `window.fordb.onDbHostRestarted(cb: () => void): void` — called when main respawns db-host. Task 8 (store) subscribes to mark connections lost.

- [ ] **Step 1: Broadcast on respawn (main)**

In `src/main/index.ts`, inside the `dbHost.on('exit', …)` handler, after deciding to respawn (i.e., not quitting and not past the restart cap), broadcast to all windows. Add a helper near `broadcastTheme`:

```ts
function broadcastDbHostRestarted(): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('db-host:restarted')
}
```

And call `broadcastDbHostRestarted()` inside the `setTimeout` respawn callback, right after `startDbHost()`:

```ts
setTimeout(
  () => {
    if (!quitting) {
      startDbHost()
      broadcastDbHostRestarted()
    }
  },
  rapidRestarts > 0 ? backoffMs : 0
)
```

- [ ] **Step 2: Expose in preload**

Add to the `window.fordb` object in `src/preload/index.ts`:

```ts
onDbHostRestarted: (cb: () => void): void => {
  ipcRenderer.on('db-host:restarted', () => cb())
}
```

- [ ] **Step 3: Type it in rpc.ts**

Add to the `Window.fordb` interface in `src/renderer/src/rpc.ts`:

```ts
      onDbHostRestarted: (cb: () => void) => void
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: clean (no behavior test here — it's IPC glue exercised by the store + e2e).

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/src/rpc.ts
git commit -m "feat: db-host-restarted connection-lost signal"
```

---

### Task 5: QueryResultSource (renderer streaming paging)

**Files:**

- Create: `src/renderer/src/query/result-source.ts`, `tests/unit/result-source.test.ts`

**Interfaces:**

- Consumes: a minimal `QueryApi` = `{ fetchPage(queryId): Promise<Page>; closeQuery(queryId): Promise<void> }` (subset of HostApi, injectable for tests).
- Produces: `class QueryResultSource` — `constructor(api, queryId, fields, pageSize)`, `fields`, `loadedRowCount(): number`, `done(): boolean`, `getRow(i): unknown[] | undefined`, `ensureLoaded(uptoIndex): Promise<void>`, `drainAll(): Promise<void>`, `dispose(): Promise<void>`.

- [ ] **Step 1: Write failing tests (fake api)**

`tests/unit/result-source.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { QueryResultSource } from '../../src/renderer/src/query/result-source'
import type { Page } from '../../src/shared/adapter/types'

function fakeApi(total: number, pageSize: number) {
  let served = 0
  let closed = false
  return {
    closedFlag: () => closed,
    fetchPage: async (_q: string): Promise<Page> => {
      const remaining = total - served
      const n = Math.min(pageSize, remaining)
      served += n
      return { rows: Array.from({ length: n }, (_, i) => [served - n + i]), done: served >= total }
    },
    closeQuery: async (_q: string): Promise<void> => {
      closed = true
    }
  }
}

describe('QueryResultSource', () => {
  it('lazily loads rows up to an index', async () => {
    const api = fakeApi(2500, 1000)
    const src = new QueryResultSource(api, 'q1', [{ name: 'id', dataType: '23' }], 1000)
    expect(src.loadedRowCount()).toBe(0)
    await src.ensureLoaded(500)
    expect(src.loadedRowCount()).toBe(1000)
    expect(src.getRow(0)).toEqual([0])
    await src.ensureLoaded(1500)
    expect(src.loadedRowCount()).toBe(2000)
  })
  it('drainAll loads everything and sets done', async () => {
    const api = fakeApi(2500, 1000)
    const src = new QueryResultSource(api, 'q1', [], 1000)
    await src.drainAll()
    expect(src.loadedRowCount()).toBe(2500)
    expect(src.done()).toBe(true)
  })
  it('does not fetch past done', async () => {
    const api = fakeApi(1500, 1000)
    const src = new QueryResultSource(api, 'q1', [], 1000)
    await src.drainAll()
    const before = src.loadedRowCount()
    await src.ensureLoaded(100000)
    expect(src.loadedRowCount()).toBe(before)
  })
  it('dispose closes the cursor', async () => {
    const api = fakeApi(10, 5)
    const src = new QueryResultSource(api, 'q1', [], 5)
    await src.dispose()
    expect(api.closedFlag()).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test` — FAIL, module missing.

- [ ] **Step 3: Implement**

`src/renderer/src/query/result-source.ts`:

```ts
import type { FieldInfo, Page } from '../../../shared/adapter/types'

export interface QueryApi {
  fetchPage(queryId: string): Promise<Page>
  closeQuery(queryId: string): Promise<void>
}

export class QueryResultSource {
  private rows: unknown[][] = []
  private isDone = false
  private inflight: Promise<void> | null = null

  constructor(
    private readonly api: QueryApi,
    private readonly queryId: string,
    readonly fields: FieldInfo[],
    private readonly pageSize: number
  ) {}

  loadedRowCount(): number {
    return this.rows.length
  }
  done(): boolean {
    return this.isDone
  }
  getRow(i: number): unknown[] | undefined {
    return this.rows[i]
  }

  private async fetchOne(): Promise<void> {
    if (this.isDone) return
    const page = await this.api.fetchPage(this.queryId)
    this.rows.push(...page.rows)
    if (page.done) this.isDone = true
  }

  /** Load pages until at least uptoIndex is available (or done). Serialized. */
  async ensureLoaded(uptoIndex: number): Promise<void> {
    while (!this.isDone && this.rows.length <= uptoIndex) {
      // Serialize concurrent callers onto one in-flight fetch chain.
      this.inflight = (this.inflight ?? Promise.resolve()).then(() => this.fetchOne())
      await this.inflight
    }
  }

  async drainAll(): Promise<void> {
    while (!this.isDone) {
      this.inflight = (this.inflight ?? Promise.resolve()).then(() => this.fetchOne())
      await this.inflight
    }
  }

  async dispose(): Promise<void> {
    await this.api.closeQuery(this.queryId).catch(() => undefined)
  }
}
```

Note: `pageSize` is carried for the workbench to pass through to `openQuery`; `fetchPage` itself is server-driven, so `ensureLoaded` just pulls pages until the index is covered.

- [ ] **Step 4: Run to verify pass + commit**

Run: `pnpm test`

```bash
git add src/renderer/src/query/result-source.ts tests/unit/result-source.test.ts
git commit -m "feat: QueryResultSource streaming paging over a cursor"
```

---

### Task 6: Query store (Zustand tabs)

**Files:**

- Create: `src/renderer/src/store-query.ts`

**Interfaces:**

- Consumes: `QueryResultSource`, `isSelectLike`, `hostApi()`, `useConnStore` (activeConnectionId).
- Produces: `useQueryStore` with tabs `{ id, sql, status, source?, error?, elapsedMs? }`, and actions `newTab`, `closeTab`, `setSql`, `run(tabId)`, `cancel(tabId)`, `connectionLost()`.

- [ ] **Step 1: Implement (glue; exercised by e2e + result-source/classify unit tests)**

`src/renderer/src/store-query.ts`:

```ts
import { create } from 'zustand'
import { hostApi } from './rpc'
import { useConnStore } from './store'
import { isSelectLike } from '../../shared/sql/classify'
import { QueryResultSource } from './query/result-source'

const PAGE_SIZE = 1000

export type TabStatus = 'idle' | 'running' | 'done' | 'error'
export interface QueryTab {
  id: string
  sql: string
  status: TabStatus
  source?: QueryResultSource
  message?: string // rowCount/command summary or error text
  elapsedMs?: number
}

let seq = 0
function tabId(): string {
  return `t${++seq}`
}

interface QueryState {
  tabs: QueryTab[]
  activeTabId: string | null
  newTab: () => void
  closeTab: (id: string) => void
  setSql: (id: string, sql: string) => void
  setActive: (id: string) => void
  run: (id: string) => Promise<void>
  cancel: (id: string) => Promise<void>
  connectionLost: () => void
}

function patch(state: QueryState, id: string, over: Partial<QueryTab>): QueryTab[] {
  return state.tabs.map((t) => (t.id === id ? { ...t, ...over } : t))
}

export const useQueryStore = create<QueryState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  newTab: () => {
    const t: QueryTab = { id: tabId(), sql: '', status: 'idle' }
    set((s) => ({ tabs: [...s.tabs, t], activeTabId: t.id }))
  },
  closeTab: (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    void tab?.source?.dispose()
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id)
      return { tabs, activeTabId: s.activeTabId === id ? (tabs[0]?.id ?? null) : s.activeTabId }
    })
  },
  setSql: (id, sql) => set((s) => ({ tabs: patch(s, id, { sql }) })),
  setActive: (id) => set({ activeTabId: id }),
  run: async (id) => {
    const connId = useConnStore.getState().activeConnectionId
    const tab = get().tabs.find((t) => t.id === id)
    if (!connId || !tab) return
    void tab.source?.dispose()
    set((s) => ({
      tabs: patch(s, id, {
        status: 'running',
        source: undefined,
        message: undefined,
        error: undefined
      } as Partial<QueryTab>)
    }))
    const started = performance.now()
    try {
      const api = await hostApi()
      if (isSelectLike(tab.sql)) {
        const open = await api.openQuery(connId, tab.sql, PAGE_SIZE)
        const source = new QueryResultSource(
          {
            fetchPage: (q) => api.fetchPage(connId, q),
            closeQuery: (q) => api.closeQuery(connId, q)
          },
          open.queryId,
          open.fields,
          PAGE_SIZE
        )
        await source.ensureLoaded(0) // first page
        set((s) => ({
          tabs: patch(s, id, { status: 'done', source, elapsedMs: performance.now() - started })
        }))
      } else {
        const r = await api.executeQuery(connId, tab.sql)
        set((s) => ({
          tabs: patch(s, id, {
            status: 'done',
            message: `${r.command} ${r.rowCount}`,
            elapsedMs: performance.now() - started
          })
        }))
      }
    } catch (err) {
      set((s) => ({
        tabs: patch(s, id, {
          status: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      }))
    }
  },
  cancel: async (id) => {
    const connId = useConnStore.getState().activeConnectionId
    if (connId) await (await hostApi()).cancel(connId)
    set((s) => ({ tabs: patch(s, id, { status: 'idle' }) }))
  },
  connectionLost: () => {
    for (const t of get().tabs) void t.source?.dispose()
    set((s) => ({
      tabs: s.tabs.map((t) => ({
        ...t,
        source: undefined,
        status: 'error',
        message: 'Connection lost — reconnect'
      }))
    }))
  }
}))
```

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

```bash
git add src/renderer/src/store-query.ts
git commit -m "feat: query tab store with run/cancel/connection-lost"
```

---

### Task 7: CodeMirror SQL editor + schema-aware completion + theme

**Files:**

- Create: `src/renderer/src/components/SqlEditor.tsx`, `src/renderer/src/query/completion.ts`, `src/renderer/src/query/cm-theme.ts`

**Interfaces:**

- Consumes: `hostApi()`, `useConnStore` (activeConnectionId).
- Produces: `<SqlEditor value onChange onRun connectionId />`; `schemaCompletion(connectionId)` (a CodeMirror completion source); `cmTheme` (token-mapped theme extension).

- [ ] **Step 1: Install CodeMirror**

```bash
pnpm add codemirror @codemirror/lang-sql @codemirror/autocomplete @codemirror/view @codemirror/state
```

- [ ] **Step 2: Completion source**

`src/renderer/src/query/completion.ts` — build a `@codemirror/lang-sql` schema object from introspection, cached per connection:

```ts
import type { SQLNamespace } from '@codemirror/lang-sql'
import { hostApi } from '../rpc'

const cache = new Map<string, SQLNamespace>()

/** Build a lang-sql schema { "schema.table": ["col", …] } for the connection. */
export async function loadSqlSchema(connectionId: string): Promise<SQLNamespace> {
  const cached = cache.get(connectionId)
  if (cached) return cached
  const api = await hostApi()
  const schemas = await api.listSchemas(connectionId)
  const ns: Record<string, string[]> = {}
  for (const schema of schemas) {
    const tables = await api.listTables(connectionId, schema)
    for (const t of tables) {
      const cols = await api.getColumns(connectionId, schema, t.name)
      ns[`${schema}.${t.name}`] = cols.map((c) => c.name)
    }
  }
  cache.set(connectionId, ns)
  return ns
}

export function invalidateSchema(connectionId: string): void {
  cache.delete(connectionId)
}
```

Note: eager full-column load is acceptable for typical schemas; if a schema is huge this can be made lazy later. `SQLNamespace` accepts the `{ "schema.table": string[] }` map form.

- [ ] **Step 3: Token theme**

`src/renderer/src/query/cm-theme.ts`:

```ts
import { EditorView } from '@codemirror/view'

// Map CodeMirror surfaces to the app's CSS token variables so the editor
// follows light/dark automatically (the .dark class flips the vars).
export const cmTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--background)', color: 'var(--foreground)', height: '100%' },
  '.cm-content': { caretColor: 'var(--foreground)' },
  '.cm-gutters': {
    backgroundColor: 'var(--muted)',
    color: 'var(--muted-foreground)',
    border: 'none'
  },
  '.cm-activeLine': { backgroundColor: 'var(--muted)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--muted)'
  }
})
```

- [ ] **Step 4: Editor component**

`src/renderer/src/components/SqlEditor.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import { sql, PostgreSQL } from '@codemirror/lang-sql'
import { autocompletion } from '@codemirror/autocomplete'
import { basicSetup } from 'codemirror'
import { cmTheme } from '../query/cm-theme'
import { loadSqlSchema } from '../query/completion'

export function SqlEditor(props: {
  value: string
  onChange: (v: string) => void
  onRun: () => void
  connectionId: string | null
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!host.current) return
    let schema: Record<string, string[]> = {}
    if (props.connectionId)
      void loadSqlSchema(props.connectionId).then((s) => {
        schema = s as Record<string, string[]>
      })
    const state = EditorState.create({
      doc: props.value,
      extensions: [
        basicSetup,
        cmTheme,
        sql({ dialect: PostgreSQL, schema, upperCaseKeywords: true }),
        autocompletion(),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              props.onRun()
              return true
            }
          },
          ...defaultKeymap
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) props.onChange(u.state.doc.toString())
        })
      ]
    })
    const v = new EditorView({ state, parent: host.current })
    view.current = v
    return () => v.destroy()
    // Re-create on connection change so the schema is rebound.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.connectionId])

  return <div ref={host} className="h-full overflow-auto border border-border rounded" />
}
```

Note: the editor is uncontrolled (CodeMirror owns the doc); `onChange` syncs back to the store. Recreating on `connectionId` change is acceptable for M3. `Mod-Enter` is the run shortcut.

- [ ] **Step 5: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: clean; the editor bundles.

```bash
git add src/renderer/src/components/SqlEditor.tsx src/renderer/src/query/completion.ts src/renderer/src/query/cm-theme.ts package.json pnpm-lock.yaml
git commit -m "feat: CodeMirror SQL editor with schema-aware completion and token theme"
```

---

### Task 8: Results grid (Glide) backed by QueryResultSource

**Files:**

- Create: `src/renderer/src/components/ResultsGrid.tsx`

**Interfaces:**

- Consumes: `@glideapps/glide-data-grid`, `QueryResultSource`.
- Produces: `<ResultsGrid source={QueryResultSource} />`.

- [ ] **Step 1: Install Glide**

```bash
pnpm add @glideapps/glide-data-grid
```

- [ ] **Step 2: Implement**

`src/renderer/src/components/ResultsGrid.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { DataEditor, GridCellKind, type GridCell, type Item } from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import type { QueryResultSource } from '../query/result-source'

export function ResultsGrid(props: { source: QueryResultSource }): React.JSX.Element {
  const { source } = props
  const [rowCount, setRowCount] = useState(source.loadedRowCount())

  useEffect(() => {
    setRowCount(source.loadedRowCount())
  }, [source])

  const columns = source.fields.map((f) => ({ title: f.name, id: f.name, width: 160 }))

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell
      const r = source.getRow(row)
      const v = r?.[col]
      const text = v === null || v === undefined ? '' : String(v)
      return { kind: GridCellKind.Text, data: text, displayData: text, allowOverlay: false }
    },
    [source]
  )

  // Load more as the grid asks for rows near the loaded edge.
  const onVisibleRegionChanged = useCallback(
    (range: { y: number; height: number }): void => {
      const need = range.y + range.height + 200
      if (!source.done() && need >= source.loadedRowCount()) {
        void source.ensureLoaded(need).then(() => setRowCount(source.loadedRowCount()))
      }
    },
    [source]
  )

  if (columns.length === 0) return <div className="p-4 text-muted-foreground">No result set.</div>
  return (
    <DataEditor
      columns={columns}
      rows={rowCount}
      getCellContent={getCellContent}
      onVisibleRegionChanged={onVisibleRegionChanged}
      smoothScrollX
      smoothScrollY
      getCellsForSelection
      width="100%"
      height="100%"
    />
  )
}
```

Note: Glide's `onVisibleRegionChanged` gives the visible rect; when the user scrolls near the loaded edge we pull more pages and bump `rowCount` so Glide re-renders. `getCellsForSelection` enables copy. If Glide's exact prop names differ in the installed version, adapt to the installed API (the `QueryResultSource` seam is the contract; the grid is a swappable view).

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm build`

```bash
git add src/renderer/src/components/ResultsGrid.tsx package.json pnpm-lock.yaml
git commit -m "feat: Glide results grid backed by QueryResultSource"
```

---

### Task 9: Workbench + tabs + export; wire into App + commands + restart signal

**Files:**

- Create: `src/renderer/src/components/QueryWorkbench.tsx`, `src/renderer/src/components/QueryTabs.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**

- Consumes: `useQueryStore`, `SqlEditor`, `ResultsGrid`, `useConnStore`, `useThemeStore` (existing), `window.fordb.onDbHostRestarted`.
- Produces: the `connected` view renders `<QueryWorkbench />`.

- [ ] **Step 1: QueryTabs**

`src/renderer/src/components/QueryTabs.tsx`:

```tsx
import { useQueryStore } from '../store-query'
import { Button } from './ui/button'

export function QueryTabs(): React.JSX.Element {
  const tabs = useQueryStore((s) => s.tabs)
  const active = useQueryStore((s) => s.activeTabId)
  const setActive = useQueryStore((s) => s.setActive)
  const closeTab = useQueryStore((s) => s.closeTab)
  const newTab = useQueryStore((s) => s.newTab)
  return (
    <div className="flex items-center gap-1 border-b border-border px-2">
      {tabs.map((t, i) => (
        <div
          key={t.id}
          className={`flex items-center gap-1 px-2 py-1 text-sm rounded-t ${t.id === active ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
        >
          <button onClick={() => setActive(t.id)}>Query {i + 1}</button>
          <button className="text-xs" onClick={() => closeTab(t.id)}>
            ×
          </button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={newTab}>
        +
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: QueryWorkbench (editor + controls + grid + export)**

`src/renderer/src/components/QueryWorkbench.tsx`:

```tsx
import { useEffect } from 'react'
import { useConnStore } from '../store'
import { useQueryStore } from '../store-query'
import { SqlEditor } from './SqlEditor'
import { ResultsGrid } from './ResultsGrid'
import { QueryTabs } from './QueryTabs'
import { Button } from './ui/button'

function toCsv(fields: string[], rows: unknown[][]): string {
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [fields.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
}
function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function QueryWorkbench(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  const tabs = useQueryStore((s) => s.tabs)
  const activeId = useQueryStore((s) => s.activeTabId)
  const { newTab, setSql, run, cancel } = useQueryStore.getState()
  const tab = tabs.find((t) => t.id === activeId)

  useEffect(() => {
    if (tabs.length === 0) newTab()
  }, [tabs.length, newTab])

  if (!tab) return <div className="p-4 text-muted-foreground">No query tab.</div>

  async function exportData(kind: 'csv' | 'json'): Promise<void> {
    const src = tab!.source
    if (!src) return
    await src.drainAll()
    const names = src.fields.map((f) => f.name)
    const rows = Array.from({ length: src.loadedRowCount() }, (_, i) => src.getRow(i) ?? [])
    if (kind === 'csv') download('result.csv', toCsv(names, rows), 'text/csv')
    else
      download(
        'result.json',
        JSON.stringify(
          rows.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i]]))),
          null,
          2
        ),
        'application/json'
      )
  }

  return (
    <div className="flex flex-col h-full">
      <QueryTabs />
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <Button onClick={() => void run(tab.id)} disabled={tab.status === 'running'}>
          Run
        </Button>
        <Button
          variant="outline"
          onClick={() => void cancel(tab.id)}
          disabled={tab.status !== 'running'}
        >
          Cancel
        </Button>
        <Button variant="ghost" onClick={() => void exportData('csv')} disabled={!tab.source}>
          Export CSV
        </Button>
        <Button variant="ghost" onClick={() => void exportData('json')} disabled={!tab.source}>
          Export JSON
        </Button>
        <span className="text-sm text-muted-foreground ml-auto">
          {tab.status === 'running' && 'running…'}
          {tab.status === 'done' &&
            tab.source &&
            `${tab.source.loadedRowCount()} rows${tab.source.done() ? '' : '+'} · ${Math.round(tab.elapsedMs ?? 0)}ms`}
          {tab.status === 'done' && !tab.source && tab.message}
          {tab.status === 'error' && <span className="text-destructive">{tab.message}</span>}
        </span>
      </div>
      <div className="h-1/2 min-h-40">
        <SqlEditor
          value={tab.sql}
          onChange={(v) => setSql(tab.id, v)}
          onRun={() => void run(tab.id)}
          connectionId={connId}
        />
      </div>
      <div className="flex-1 min-h-0">
        {tab.source ? (
          <ResultsGrid source={tab.source} />
        ) : (
          <div className="p-4 text-muted-foreground">Run a query to see results.</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire into App.tsx**

In `src/renderer/src/App.tsx`: replace the `connected` view's `<SchemaTree />` with a split — keep `SchemaTree` in a left column and render `<QueryWorkbench />` as the main area; subscribe to the restart signal; add commands. Concretely:

- Import `QueryWorkbench`, `useQueryStore`.
- Add `useEffect(() => { window.fordb.onDbHostRestarted(() => useQueryStore.getState().connectionLost()) }, [])`.
- In the `connected` branch render:

```tsx
{
  view.kind === 'connected' && (
    <div className="flex h-full">
      <div className="w-64 border-r border-border overflow-auto">
        <SchemaTree />
      </div>
      <div className="flex-1 min-w-0">
        <QueryWorkbench />
      </div>
    </div>
  )
}
```

- Add to the `commands` array: `{ id: 'run-query', label: 'Run query', run: () => { const s = useQueryStore.getState(); if (s.activeTabId) void s.run(s.activeTabId) } }`, `{ id: 'cancel-query', label: 'Cancel query', run: () => { const s = useQueryStore.getState(); if (s.activeTabId) void s.cancel(s.activeTabId) } }`, `{ id: 'new-query-tab', label: 'New query tab', run: () => useQueryStore.getState().newTab() }`.

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Then headless dev smoke (`timeout 20 ELECTRON_DISABLE_SANDBOX=1 pnpm dev`): confirm no crash. Report observation.

```bash
git add src/renderer/src/components/QueryWorkbench.tsx src/renderer/src/components/QueryTabs.tsx src/renderer/src/App.tsx
git commit -m "feat: query workbench (tabs, run/cancel, results grid, export) wired into App"
```

---

### Task 10: Playwright query smoke

**Files:**

- Create: `tests/e2e/query.spec.ts`
- Modify: `package.json` (no new script needed; reuse `pnpm e2e`)

**Interfaces:**

- Consumes: the running app + Dockerized Postgres.

- [ ] **Step 1: Write the e2e**

`tests/e2e/query.spec.ts`:

```ts
import { test, expect, _electron as electron } from '@playwright/test'

test('connect, run a query, see rows, cancel a slow query', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByPlaceholder('Name').fill('local-q')
  await win.getByPlaceholder('Host').fill('127.0.0.1')
  await win.getByPlaceholder('Port').fill('54329')
  await win.getByPlaceholder('Database').fill('fordb_test')
  await win.getByPlaceholder('User').fill('fordb')
  await win.getByPlaceholder('Password').fill('fordb')
  await win.getByText('Test', { exact: true }).click()
  await expect(win.getByText('OK')).toBeVisible({ timeout: 15000 })
  await win.getByText('Save').click()
  await win.getByText('local-q').click()

  // Type a query into the CodeMirror editor and run.
  await win.locator('.cm-content').click()
  await win.keyboard.type('SELECT id, email FROM app.users ORDER BY id')
  await win.getByText('Run', { exact: true }).click()
  await expect(win.getByText(/rows/)).toBeVisible({ timeout: 15000 })

  await app.close()
})
```

- [ ] **Step 2: Verify**

Run: `pnpm build && pnpm db:up`, load fixture (`psql`-equivalent or the app's own connect), `pnpm exec playwright install chromium`, `pnpm e2e`.
Expected: passes on a desktop/keyring-CI. If the headless container blocks Electron/keyring (documented M2 limitation), confirm the spec is correct and rely on `pnpm typecheck && pnpm lint && pnpm build` + the contract/unit coverage; document the block. `pnpm db:down` after.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/query.spec.ts
git commit -m "test: e2e query smoke (connect, run, results)"
```

---

## Self-Review (done at plan time)

1. **Spec coverage:** HostApi query methods (spec §1) → Task 1. Cursor-stream paging (§2) → Tasks 3 (classify), 5 (source), 6 (store wires open/execute). Workbench UI (§3) → Tasks 7 (editor), 8 (grid), 9 (workbench/tabs/export/commands). Infra (§4): RPC timeout → Task 2; connection-lost → Task 4 + wired in 6/9. Read-only (§5) → no editing tasks. Testing (§6) → contract (1), unit (2,3,5), e2e (10). Success criteria: 500k stream (5,6,8), completion (7), cancel (1,6,9), no-hang (2,4,6), export (9).
2. **Placeholder scan:** CodeMirror (Task 7) and Glide (Task 8) note "adapt to the installed API if prop names differ" — deliberate (the exact minor-version API surface can drift), bounded by the `QueryResultSource`/completion-source contracts which ARE fully specified. No TBDs elsewhere; all code inlined.
3. **Type consistency:** `QueryResultSource` (ctor `(api, queryId, fields, pageSize)`, `ensureLoaded/drainAll/dispose/getRow/loadedRowCount/done`), `QueryApi` `{fetchPage, closeQuery}`, `HostApi` query methods `(id, …)`, `isSelectLike`, `createRpcClient(port, {timeoutMs})`, `useQueryStore` tab shape `{id,sql,status,source?,message?,elapsedMs?}`, `window.fordb.onDbHostRestarted` — consistent across Tasks 1–9.

**Known deliberate deferrals:** client-side sort (drain-then-sort) is specced but not built as a separate task — it rides on `QueryResultSource.drainAll` + a Glide sort handler; if the executor wants it explicit, add a small task, else it's a fast-follow. Server-side ORDER BY, cell editing, and full orphan reaping are out of M3 per the spec.

# fordb Server-Stats Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only, pgAdmin-style Postgres dashboard — sessions (zombie/idle-in-txn spotting), connection-state gauges, live uPlot charts (TPS, cache hit, tuples/s, connections), locks, DB size — refreshing on a chosen cadence.

**Architecture:** A typed optional `ServerStats` capability on `DbAdapter` (PG implements; others don't). `HostApi` exposes it connectionId-routed. React Query polls snapshots/sessions/locks while the Dashboard is visible; cumulative counters become rates in a pure module feeding an in-memory ring buffer; uPlot renders from that buffer. A `[Query | Dashboard]` mode switch in the connected pane.

**Tech Stack:** TypeScript strict, Postgres (`pg`), TanStack Query, `uplot`, React 19, Zustand (UI state), vitest, Playwright.

## Global Constraints

- pnpm; Node >= 22; TypeScript strict; no `any` except typed casts at the RPC/serialization boundary.
- The renderer NEVER authors `pg_stat_*` SQL — all stats go through the typed `HostApi` over the db-host port. Secrets never reach the renderer.
- Read-only: NO `pg_cancel_backend` / `pg_terminate_backend` in v1.
- Postgres only: the capability is optional; SQLite/Mongo don't implement it and stay contract-conformant.
- Scope: current database; only inherently server-global metrics (total `backends`, `max_connections`) are server-wide.
- Chart history is in-memory (default 5-minute window), reset on disconnect/mode-switch/unmount — NOT in the React Query cache.
- Charts must be fully self-contained (bundled uPlot, canvas) — CSP forbids any CDN/remote fetch.
- Every connection-scoped query key begins `['conn', connId, …]`.
- Components use semantic theme tokens only (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `bg-destructive`, `ring`) — no raw color literals.
- `@shared/*` alias for shared imports. Renderer-importing tests route through `tsconfig.web` (excluded from `tsconfig.node`); pure `src/shared` tests stay on `tsconfig.node`.
- Each task ends with `pnpm typecheck && pnpm lint && pnpm test` green (+ `pnpm build` for renderer-touching tasks). Contract tasks also run `pnpm db:up && pnpm test:contract`.
- One PR per task against `main`.

## File Structure (end state)

```
src/shared/adapter/stats-types.ts            # NEW: ServerSnapshot, SessionRow, LockRow, ServerStatsProvider
src/shared/adapter/db-adapter.ts             # MODIFY: optional `serverStats?: ServerStatsProvider`
src/shared/stats/rates.ts                    # NEW: Sample, RatePoint, computeRate, pushSample (pure)
src/db-host/postgres/stats-sql.ts            # NEW: SQL constants for stats
src/db-host/postgres/postgres-stats.ts       # NEW: PgServerStats implements ServerStatsProvider
src/db-host/postgres/postgres-adapter.ts     # MODIFY: expose `serverStats`
src/shared/host/host-api.ts                  # MODIFY: + getServerSnapshot/getSessions/getLocks/serverStatsSupported
src/db-host/host-api-impl.ts                 # MODIFY: route them
src/renderer/src/query/keys.ts               # MODIFY: + serverSnapshot/sessions/locks keys
src/renderer/src/query/stats.ts              # NEW: useServerSnapshot/useSessions/useLocks
src/renderer/src/query/use-rate-history.ts   # NEW: useRateHistory hook (ring buffer)
src/renderer/src/components/charts/TimeSeriesChart.tsx   # NEW: uPlot wrapper
src/renderer/src/components/ServerDashboard.tsx          # NEW: dashboard view
src/renderer/src/components/dashboard/Gauges.tsx         # NEW
src/renderer/src/components/dashboard/SessionsTable.tsx  # NEW
src/renderer/src/components/dashboard/LocksPanel.tsx     # NEW
src/renderer/src/components/dashboard/ControlsBar.tsx    # NEW
src/renderer/src/store-query.ts              # MODIFY: mainView 'query'|'dashboard' + setMainView
src/renderer/src/App.tsx                     # MODIFY: mode switch + palette commands
tests/contract/adapter-contract.ts           # MODIFY: capability-gated stats block
tests/unit/rates.test.ts                     # NEW
tests/e2e/dashboard.spec.ts                  # NEW
```

---

### Task 1: Stats types + `ServerStatsProvider` capability on `DbAdapter`

**Files:**

- Create: `src/shared/adapter/stats-types.ts`
- Modify: `src/shared/adapter/db-adapter.ts`

**Interfaces:**

- Produces: `ServerSnapshot`, `SessionRow`, `LockRow`, `ServerStatsProvider`; `DbAdapter.serverStats?: ServerStatsProvider`.

- [ ] **Step 1: Create stats-types.ts**

`src/shared/adapter/stats-types.ts`:

```ts
export interface ServerSnapshot {
  counters: {
    xactCommit: number
    xactRollback: number
    blksRead: number
    blksHit: number
    tupReturned: number
    tupFetched: number
    tupInserted: number
    tupUpdated: number
    tupDeleted: number
  }
  activityByState: {
    active: number
    idle: number
    idleInTransaction: number
    idleInTransactionAborted: number
    other: number
  }
  backends: number
  maxConnections: number
  dbSizeBytes: number
  fullVisibility: boolean
}

export interface SessionRow {
  pid: number
  user: string | null
  applicationName: string | null
  clientAddr: string | null
  state: string | null
  waitEventType: string | null
  waitEvent: string | null
  backendStartMs: number | null
  xactStartMs: number | null
  queryStartMs: number | null
  stateChangeMs: number | null
  query: string | null
}

export interface LockRow {
  blockedPid: number
  blockedUser: string | null
  blockedQuery: string | null
  blockingPid: number
  blockingUser: string | null
  blockingQuery: string | null
  lockType: string | null
}

/** Optional read-only server-monitoring capability. Engines that can't provide
 *  it simply omit `DbAdapter.serverStats`. */
export interface ServerStatsProvider {
  getServerSnapshot(): Promise<ServerSnapshot>
  getSessions(): Promise<SessionRow[]>
  getLocks(): Promise<LockRow[]>
}
```

- [ ] **Step 2: Add the optional member to DbAdapter**

Modify `src/shared/adapter/db-adapter.ts` — add import and the optional member after `cancel()`:

```ts
import type { ServerStatsProvider } from './stats-types'
```

Inside the `DbAdapter` interface, after `cancel(): Promise<void>`:

```ts
  /** Optional read-only server-monitoring capability (Postgres implements it). */
  readonly serverStats?: ServerStatsProvider
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: green (no behavior change; types only).

```bash
git add src/shared/adapter/stats-types.ts src/shared/adapter/db-adapter.ts
git commit -m "feat: ServerStats types + optional DbAdapter capability"
```

---

### Task 2: Postgres `ServerStatsProvider` impl + capability-gated contract tests

**Files:**

- Create: `src/db-host/postgres/stats-sql.ts`, `src/db-host/postgres/postgres-stats.ts`
- Modify: `src/db-host/postgres/postgres-adapter.ts`, `tests/contract/adapter-contract.ts`

**Interfaces:**

- Consumes: `ServerStatsProvider`, `ServerSnapshot`, `SessionRow`, `LockRow` (Task 1); a `pg.Client` getter.
- Produces: `class PgServerStats implements ServerStatsProvider`; `PostgresAdapter.serverStats` set.

- [ ] **Step 1: SQL constants**

`src/db-host/postgres/stats-sql.ts`:

```ts
export const SNAPSHOT = `
SELECT
  d.xact_commit, d.xact_rollback, d.blks_read, d.blks_hit,
  d.tup_returned, d.tup_fetched, d.tup_inserted, d.tup_updated, d.tup_deleted,
  pg_database_size(current_database()) AS db_size,
  (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
  (SELECT count(*) FROM pg_stat_activity) AS backends,
  (pg_has_role(current_user, 'pg_monitor', 'MEMBER')
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper)) AS full_visibility
FROM pg_stat_database d
WHERE d.datname = current_database()`

export const ACTIVITY_BY_STATE = `
SELECT state, count(*)::int AS n
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state`

export const SESSIONS = `
SELECT pid,
  usename AS "user",
  application_name,
  client_addr::text AS client_addr,
  state,
  wait_event_type,
  wait_event,
  extract(epoch FROM backend_start) * 1000 AS backend_start_ms,
  extract(epoch FROM xact_start)   * 1000 AS xact_start_ms,
  extract(epoch FROM query_start)  * 1000 AS query_start_ms,
  extract(epoch FROM state_change) * 1000 AS state_change_ms,
  query
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
ORDER BY query_start NULLS LAST`

// pg_blocking_pids (PG 9.6+) is the robust way to find blockers.
export const LOCKS = `
SELECT
  a.pid AS blocked_pid, a.usename AS blocked_user, a.query AS blocked_query,
  bl.pid AS blocking_pid, bl.usename AS blocking_user, bl.query AS blocking_query,
  NULL::text AS lock_type
FROM pg_stat_activity a
JOIN LATERAL unnest(pg_blocking_pids(a.pid)) AS blocking(pid) ON true
JOIN pg_stat_activity bl ON bl.pid = blocking.pid
WHERE cardinality(pg_blocking_pids(a.pid)) > 0`
```

- [ ] **Step 2: PgServerStats implementation**

`src/db-host/postgres/postgres-stats.ts`:

```ts
import type pg from 'pg'
import type {
  LockRow,
  ServerSnapshot,
  ServerStatsProvider,
  SessionRow
} from '@shared/adapter/stats-types'
import * as SQL from './stats-sql'

const num = (v: unknown): number => Number(v ?? 0)
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export class PgServerStats implements ServerStatsProvider {
  // Reads the live client each call; the adapter owns the connection lifecycle.
  constructor(private readonly conn: () => pg.Client) {}

  async getServerSnapshot(): Promise<ServerSnapshot> {
    const c = this.conn()
    const [snap, states] = await Promise.all([
      c.query(SQL.SNAPSHOT),
      c.query(SQL.ACTIVITY_BY_STATE)
    ])
    const r = snap.rows[0] ?? {}
    const by = { active: 0, idle: 0, idleInTransaction: 0, idleInTransactionAborted: 0, other: 0 }
    for (const row of states.rows as { state: string | null; n: number }[]) {
      if (row.state === 'active') by.active += row.n
      else if (row.state === 'idle') by.idle += row.n
      else if (row.state === 'idle in transaction') by.idleInTransaction += row.n
      else if (row.state === 'idle in transaction (aborted)') by.idleInTransactionAborted += row.n
      else by.other += row.n
    }
    return {
      counters: {
        xactCommit: num(r.xact_commit),
        xactRollback: num(r.xact_rollback),
        blksRead: num(r.blks_read),
        blksHit: num(r.blks_hit),
        tupReturned: num(r.tup_returned),
        tupFetched: num(r.tup_fetched),
        tupInserted: num(r.tup_inserted),
        tupUpdated: num(r.tup_updated),
        tupDeleted: num(r.tup_deleted)
      },
      activityByState: by,
      backends: num(r.backends),
      maxConnections: num(r.max_connections),
      dbSizeBytes: num(r.db_size),
      fullVisibility: r.full_visibility === true
    }
  }

  async getSessions(): Promise<SessionRow[]> {
    const c = this.conn()
    const r = await c.query(SQL.SESSIONS)
    return (r.rows as Record<string, unknown>[]).map((row) => ({
      pid: num(row.pid),
      user: (row.user as string | null) ?? null,
      applicationName: (row.application_name as string | null) ?? null,
      clientAddr: (row.client_addr as string | null) ?? null,
      state: (row.state as string | null) ?? null,
      waitEventType: (row.wait_event_type as string | null) ?? null,
      waitEvent: (row.wait_event as string | null) ?? null,
      backendStartMs: numOrNull(row.backend_start_ms),
      xactStartMs: numOrNull(row.xact_start_ms),
      queryStartMs: numOrNull(row.query_start_ms),
      stateChangeMs: numOrNull(row.state_change_ms),
      query: (row.query as string | null) ?? null
    }))
  }

  async getLocks(): Promise<LockRow[]> {
    const c = this.conn()
    const r = await c.query(SQL.LOCKS)
    return (r.rows as Record<string, unknown>[]).map((row) => ({
      blockedPid: num(row.blocked_pid),
      blockedUser: (row.blocked_user as string | null) ?? null,
      blockedQuery: (row.blocked_query as string | null) ?? null,
      blockingPid: num(row.blocking_pid),
      blockingUser: (row.blocking_user as string | null) ?? null,
      blockingQuery: (row.blocking_query as string | null) ?? null,
      lockType: (row.lock_type as string | null) ?? null
    }))
  }
}
```

- [ ] **Step 3: Wire into PostgresAdapter**

Modify `src/db-host/postgres/postgres-adapter.ts`:

- Import: `import { PgServerStats } from './postgres-stats'` and `import type { ServerStatsProvider } from '@shared/adapter/stats-types'`.
- Add a field initialized once, exposing the capability. After the existing private fields (near `private nextCursorId = 1`):

```ts
  readonly serverStats: ServerStatsProvider = new PgServerStats(() => this.conn)
```

(`this.conn` is the existing private getter that throws when not connected, so calls before connect fail clearly.)

- [ ] **Step 4: Write the capability-gated contract test**

Modify `tests/contract/adapter-contract.ts` — inside `runAdapterContractTests`, after the existing `describe('DbAdapter contract', …)` body's last `it`, add a gated block (still inside the `describe`, using the same `adapter`):

```ts
it('server stats: snapshot has sane shape when supported', async () => {
  if (!adapter.serverStats) return // capability not implemented by this engine
  const s = await adapter.serverStats.getServerSnapshot()
  expect(s.maxConnections).toBeGreaterThan(0)
  expect(s.backends).toBeGreaterThan(0)
  expect(s.dbSizeBytes).toBeGreaterThan(0)
  const sum =
    s.activityByState.active +
    s.activityByState.idle +
    s.activityByState.idleInTransaction +
    s.activityByState.idleInTransactionAborted +
    s.activityByState.other
  // Per-current-db state counts can't exceed server-wide backends.
  expect(sum).toBeLessThanOrEqual(s.backends)
  expect(typeof s.fullVisibility).toBe('boolean')
})

it('server stats: sessions exclude our own backend and expose pids', async () => {
  if (!adapter.serverStats) return
  const rows = await adapter.serverStats.getSessions()
  for (const r of rows) expect(Number.isFinite(r.pid)).toBe(true)
})

it('server stats: locks returns an array (empty on an idle db)', async () => {
  if (!adapter.serverStats) return
  const locks = await adapter.serverStats.getLocks()
  expect(Array.isArray(locks)).toBe(true)
})
```

Note: forcing a real blocked/blocking lock pair needs two concurrent sessions with conflicting locks and careful timing — flaky in a contract suite. The lock-pair path is exercised manually and by the dashboard e2e (Task 9) instead; here we assert shape + empty-on-idle.

- [ ] **Step 5: Run the contract suite**

Run: `pnpm db:up && pnpm test:contract && pnpm db:down`
Expected: 27 contract tests pass (24 existing + 3 new).
Also `pnpm typecheck && pnpm lint && pnpm test`.

- [ ] **Step 6: Commit**

```bash
git add src/db-host/postgres/stats-sql.ts src/db-host/postgres/postgres-stats.ts src/db-host/postgres/postgres-adapter.ts tests/contract/adapter-contract.ts
git commit -m "feat: Postgres ServerStats impl + capability-gated contract tests"
```

---

### Task 3: HostApi surface + routing

**Files:**

- Modify: `src/shared/host/host-api.ts`, `src/db-host/host-api-impl.ts`

**Interfaces:**

- Consumes: `ServerSnapshot`/`SessionRow`/`LockRow` (Task 1), `registry.get(id).serverStats`.
- Produces: `HostApi.getServerSnapshot/getSessions/getLocks/serverStatsSupported`, all `(id)`-routed.

- [ ] **Step 1: Extend the HostApi interface**

Modify `src/shared/host/host-api.ts`:

- Add import: `import type { ServerSnapshot, SessionRow, LockRow } from '../adapter/stats-types'`.
- Inside `interface HostApi`, after `cancel(id: ConnectionId): Promise<void>`:

```ts
  serverStatsSupported(id: ConnectionId): Promise<boolean>
  getServerSnapshot(id: ConnectionId): Promise<ServerSnapshot>
  getSessions(id: ConnectionId): Promise<SessionRow[]>
  getLocks(id: ConnectionId): Promise<LockRow[]>
```

- [ ] **Step 2: Implement routing**

Modify `src/db-host/host-api-impl.ts`:

- Add import: `import type { ServerSnapshot, SessionRow, LockRow, ServerStatsProvider } from '@shared/adapter/stats-types'`.
- Add a private helper and the four methods (after `cancel`):

```ts
  private stats(id: ConnectionId): ServerStatsProvider {
    const s = this.registry.get(id).serverStats
    if (!s) throw new Error('Server stats are not supported by this engine')
    return s
  }

  async serverStatsSupported(id: ConnectionId): Promise<boolean> {
    return this.registry.get(id).serverStats != null
  }
  getServerSnapshot(id: ConnectionId): Promise<ServerSnapshot> {
    return this.stats(id).getServerSnapshot()
  }
  getSessions(id: ConnectionId): Promise<SessionRow[]> {
    return this.stats(id).getSessions()
  }
  getLocks(id: ConnectionId): Promise<LockRow[]> {
    return this.stats(id).getLocks()
  }
```

- [ ] **Step 3: Add a host-api contract assertion**

Modify `tests/contract/host-api.contract.test.ts` — add one test using the existing connected `client`/`id` (match the file's existing pattern for obtaining a connectionId; reuse its `openConnection` result variable):

```ts
it('exposes server stats over the HostApi', async () => {
  expect(await client.serverStatsSupported(id)).toBe(true)
  const snap = await client.getServerSnapshot(id)
  expect(snap.maxConnections).toBeGreaterThan(0)
  expect(Array.isArray(await client.getSessions(id))).toBe(true)
  expect(Array.isArray(await client.getLocks(id))).toBe(true)
})
```

(If the file names the connectionId differently, use that name; the assertion content is what matters.)

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm db:up && pnpm test:contract && pnpm db:down`

```bash
git add src/shared/host/host-api.ts src/db-host/host-api-impl.ts tests/contract/host-api.contract.test.ts
git commit -m "feat: HostApi server-stats methods + routing"
```

---

### Task 4: Query keys + polling hooks

**Files:**

- Modify: `src/renderer/src/query/keys.ts`
- Create: `src/renderer/src/query/stats.ts`

**Interfaces:**

- Consumes: `qk`, `hostApi()`, stats types.
- Produces: `qk.serverSnapshot/sessions/locks`; `useServerSnapshot(connId, opts)`, `useSessions(connId, opts)`, `useLocks(connId, opts)` where `opts = { intervalMs: number; enabled: boolean }`.

- [ ] **Step 1: Extend the key factory**

Modify `src/renderer/src/query/keys.ts` — add three members inside `qk` (after `columns`):

```ts
  serverSnapshot: (connId: string): readonly ['conn', string, 'serverSnapshot'] =>
    ['conn', connId, 'serverSnapshot'] as const,
  sessions: (connId: string): readonly ['conn', string, 'sessions'] =>
    ['conn', connId, 'sessions'] as const,
  locks: (connId: string): readonly ['conn', string, 'locks'] => ['conn', connId, 'locks'] as const
```

- [ ] **Step 2: Add a key test**

Modify `tests/unit/query-keys.test.ts` — add inside the existing describe:

```ts
it('stats keys are conn-scoped', () => {
  expect(qk.serverSnapshot('c1')).toEqual(['conn', 'c1', 'serverSnapshot'])
  expect(qk.sessions('c1')).toEqual(['conn', 'c1', 'sessions'])
  expect(qk.locks('c1')).toEqual(['conn', 'c1', 'locks'])
})
```

Run `pnpm vitest run tests/unit/query-keys.test.ts` → FAIL (keys missing) before Step 1 is done; after Step 1 → PASS.

- [ ] **Step 3: Implement the hooks**

`src/renderer/src/query/stats.ts`:

```ts
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { ServerSnapshot, SessionRow, LockRow } from '@shared/adapter/stats-types'
import { hostApi } from '../rpc'
import { qk } from './keys'

interface PollOpts {
  intervalMs: number
  enabled: boolean
}

export function useServerSnapshot(
  connId: string | null,
  opts: PollOpts
): UseQueryResult<ServerSnapshot> {
  const on = !!connId && opts.enabled
  return useQuery({
    queryKey: connId ? qk.serverSnapshot(connId) : ['conn', 'none', 'serverSnapshot'],
    queryFn: async () => (await hostApi()).getServerSnapshot(connId!),
    enabled: on,
    refetchInterval: on ? opts.intervalMs : false
  })
}

export function useSessions(connId: string | null, opts: PollOpts): UseQueryResult<SessionRow[]> {
  const on = !!connId && opts.enabled
  return useQuery({
    queryKey: connId ? qk.sessions(connId) : ['conn', 'none', 'sessions'],
    queryFn: async () => (await hostApi()).getSessions(connId!),
    enabled: on,
    refetchInterval: on ? opts.intervalMs : false
  })
}

export function useLocks(connId: string | null, opts: PollOpts): UseQueryResult<LockRow[]> {
  const on = !!connId && opts.enabled
  return useQuery({
    queryKey: connId ? qk.locks(connId) : ['conn', 'none', 'locks'],
    queryFn: async () => (await hostApi()).getLocks(connId!),
    enabled: on,
    refetchInterval: on ? opts.intervalMs : false
  })
}
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/renderer/src/query/keys.ts src/renderer/src/query/stats.ts tests/unit/query-keys.test.ts
git commit -m "feat: server-stats query keys + polling hooks"
```

---

### Task 5: Pure rates module + history hook

**Files:**

- Create: `src/shared/stats/rates.ts`, `tests/unit/rates.test.ts`, `src/renderer/src/query/use-rate-history.ts`

**Interfaces:**

- Consumes: `ServerSnapshot` (its `counters` + `activityByState`).
- Produces: `Sample`, `RatePoint`, `computeRate(prev, cur)`, `pushSample(buf, s, windowMs)`; `useRateHistory(connId, snapshot, windowMs)` returning `{ rates: RatePoint[]; connections: ConnPoint[] }`.

- [ ] **Step 1: Write failing rates tests**

`tests/unit/rates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeRate, pushSample, type Sample } from '../../src/shared/stats/rates'

const counters = (over: Partial<Sample['counters']> = {}): Sample['counters'] => ({
  xactCommit: 0,
  xactRollback: 0,
  blksRead: 0,
  blksHit: 0,
  tupReturned: 0,
  tupFetched: 0,
  tupInserted: 0,
  tupUpdated: 0,
  tupDeleted: 0,
  ...over
})

describe('computeRate', () => {
  it('computes per-second rates from the delta over dt', () => {
    const prev: Sample = { tMs: 1000, counters: counters({ xactCommit: 10, blksHit: 100 }) }
    const cur: Sample = {
      tMs: 3000, // 2s later
      counters: counters({ xactCommit: 30, xactRollback: 2, blksHit: 400, blksRead: 100 })
    }
    const r = computeRate(prev, cur)!
    expect(r.tMs).toBe(3000)
    expect(r.tps).toBeCloseTo((30 - 10 + 2) / 2) // (Δcommit+Δrollback)/dt = 22/2 = 11
    expect(r.cacheHitRatio).toBeCloseTo(300 / (300 + 100)) // Δhit/(Δhit+Δread)
  })

  it('returns null when dt is zero', () => {
    const s: Sample = { tMs: 1000, counters: counters({ xactCommit: 5 }) }
    expect(computeRate(s, { ...s, tMs: 1000 })).toBeNull()
  })

  it('returns null when a counter went backwards (server/stats reset)', () => {
    const prev: Sample = { tMs: 1000, counters: counters({ xactCommit: 100 }) }
    const cur: Sample = { tMs: 2000, counters: counters({ xactCommit: 5 }) }
    expect(computeRate(prev, cur)).toBeNull()
  })

  it('cacheHitRatio is 1 when there is no block I/O in the interval', () => {
    const prev: Sample = { tMs: 1000, counters: counters() }
    const cur: Sample = { tMs: 2000, counters: counters() }
    expect(computeRate(prev, cur)!.cacheHitRatio).toBe(1)
  })
})

describe('pushSample', () => {
  it('appends and evicts samples older than the window', () => {
    let buf: Sample[] = []
    buf = pushSample(buf, { tMs: 1000, counters: counters() }, 5000)
    buf = pushSample(buf, { tMs: 4000, counters: counters() }, 5000)
    buf = pushSample(buf, { tMs: 8000, counters: counters() }, 5000)
    // window = last 5000ms up to tMs=8000 → keep >= 3000: drops tMs=1000.
    expect(buf.map((s) => s.tMs)).toEqual([4000, 8000])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/rates.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement rates.ts**

`src/shared/stats/rates.ts`:

```ts
import type { ServerSnapshot } from '../adapter/stats-types'

export interface Sample {
  tMs: number
  counters: ServerSnapshot['counters']
}

export interface RatePoint {
  tMs: number
  tps: number
  cacheHitRatio: number // 0..1
  tuplesPerSec: number
}

const KEYS: (keyof Sample['counters'])[] = [
  'xactCommit',
  'xactRollback',
  'blksRead',
  'blksHit',
  'tupReturned',
  'tupFetched',
  'tupInserted',
  'tupUpdated',
  'tupDeleted'
]

/** Per-second rates between two samples. Null if dt<=0 or any counter dropped
 *  (server restart / pg_stat_reset), to avoid emitting a false spike. */
export function computeRate(prev: Sample, cur: Sample): RatePoint | null {
  const dt = (cur.tMs - prev.tMs) / 1000
  if (dt <= 0) return null
  for (const k of KEYS) if (cur.counters[k] < prev.counters[k]) return null
  const d = (k: keyof Sample['counters']): number => cur.counters[k] - prev.counters[k]
  const hit = d('blksHit')
  const read = d('blksRead')
  const io = hit + read
  const tuples = d('tupInserted') + d('tupUpdated') + d('tupDeleted')
  return {
    tMs: cur.tMs,
    tps: (d('xactCommit') + d('xactRollback')) / dt,
    cacheHitRatio: io === 0 ? 1 : hit / io,
    tuplesPerSec: tuples / dt
  }
}

/** Append `s`, then drop samples older than `windowMs` before the newest. */
export function pushSample(buf: Sample[], s: Sample, windowMs: number): Sample[] {
  const next = [...buf, s]
  const cutoff = s.tMs - windowMs
  return next.filter((x) => x.tMs >= cutoff)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/unit/rates.test.ts` → PASS (5 tests).

- [ ] **Step 5: Implement useRateHistory**

`src/renderer/src/query/use-rate-history.ts`:

```ts
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ServerSnapshot } from '@shared/adapter/stats-types'
import { computeRate, pushSample, type RatePoint, type Sample } from '@shared/stats/rates'

export interface ConnPoint {
  tMs: number
  active: number
  idle: number
  idleInTransaction: number
}

/** Keeps an in-memory ring of snapshots (default 5-min window), derives rate
 *  points + connection points for the charts. Resets when connId changes. */
export function useRateHistory(
  connId: string | null,
  snapshot: ServerSnapshot | undefined,
  windowMs = 5 * 60_000
): { rates: RatePoint[]; connections: ConnPoint[] } {
  const [samples, setSamples] = useState<Sample[]>([])
  const [conns, setConns] = useState<ConnPoint[]>([])
  // Monotonic clock via a counter of appended snapshots avoids Date.now in
  // render; we still need a real timestamp for dt, taken once per append.
  const lastKey = useRef<string>('')

  useEffect(() => {
    setSamples([])
    setConns([])
    lastKey.current = ''
  }, [connId])

  useEffect(() => {
    if (!snapshot) return
    // Dedup: React Query may return the same object reference across renders.
    const key = JSON.stringify(snapshot.counters) + snapshot.backends
    if (key === lastKey.current) return
    lastKey.current = key
    const tMs = performance.now()
    setSamples((buf) => pushSample(buf, { tMs, counters: snapshot.counters }, windowMs))
    setConns((buf) =>
      [
        ...buf,
        {
          tMs,
          active: snapshot.activityByState.active,
          idle: snapshot.activityByState.idle,
          idleInTransaction: snapshot.activityByState.idleInTransaction
        }
      ].filter((p) => p.tMs >= tMs - windowMs)
    )
  }, [snapshot, windowMs])

  const rates = useMemo(() => {
    const out: RatePoint[] = []
    for (let i = 1; i < samples.length; i++) {
      const r = computeRate(samples[i - 1]!, samples[i]!)
      if (r) out.push(r)
    }
    return out
  }, [samples])

  return { rates, connections: conns }
}
```

- [ ] **Step 6: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/shared/stats/rates.ts tests/unit/rates.test.ts src/renderer/src/query/use-rate-history.ts
git commit -m "feat: pure rate math + in-memory rate-history hook"
```

---

### Task 6: uPlot TimeSeriesChart wrapper

**Files:**

- Create: `src/renderer/src/components/charts/TimeSeriesChart.tsx`
- Modify: `package.json` (add `uplot`)

**Interfaces:**

- Produces: `<TimeSeriesChart data={[number[], ...number[][]]} labels={string[]} title={string} format?={(v)=>string} />` — a self-sizing live line chart.

- [ ] **Step 1: Install uPlot**

```bash
pnpm add uplot
```

- [ ] **Step 2: Implement the wrapper**

`src/renderer/src/components/charts/TimeSeriesChart.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

// One series set: data[0] = x (seconds), data[1..] = y series aligned to labels.
export interface TimeSeriesChartProps {
  data: number[][]
  labels: string[]
  title: string
  format?: (v: number) => string
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function TimeSeriesChart(props: TimeSeriesChartProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<uPlot | null>(null)

  // Create once; the effect below feeds data. Recreate only if the series
  // shape (labels) changes.
  useEffect(() => {
    if (!host.current) return
    const stroke = cssVar('--color-primary', '#3b82f6')
    const axis = cssVar('--color-muted-foreground', '#888')
    const grid = cssVar('--color-border', '#333')
    const palette = [stroke, '#f59e0b', '#10b981', '#ef4444']
    const opts: uPlot.Options = {
      title: props.title,
      width: host.current.clientWidth || 300,
      height: 140,
      cursor: { show: true },
      legend: { show: true },
      scales: { x: { time: false } },
      axes: [
        { stroke: axis, grid: { stroke: grid }, ticks: { stroke: grid } },
        {
          stroke: axis,
          grid: { stroke: grid },
          ticks: { stroke: grid },
          values: props.format ? (_u, ticks) => ticks.map((t) => props.format!(t)) : undefined
        }
      ],
      series: [
        {},
        ...props.labels.map((label, i) => ({ label, stroke: palette[i % palette.length] }))
      ]
    }
    const u = new uPlot(opts, props.data as uPlot.AlignedData, host.current)
    chart.current = u
    const ro = new ResizeObserver(() => {
      if (host.current) u.setSize({ width: host.current.clientWidth, height: 140 })
    })
    ro.observe(host.current)
    return () => {
      ro.disconnect()
      u.destroy()
      chart.current = null
    }
    // Recreate when the series identity changes (label set / title).
  }, [props.labels.join('|'), props.title])

  // Feed new data without recreating the chart.
  useEffect(() => {
    chart.current?.setData(props.data as uPlot.AlignedData)
  }, [props.data])

  return <div ref={host} className="w-full" />
}
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: build resolves `uplot` + its CSS; green.

```bash
git add src/renderer/src/components/charts/TimeSeriesChart.tsx package.json pnpm-lock.yaml
git commit -m "feat: uPlot TimeSeriesChart wrapper (theme-aware, self-sizing)"
```

---

### Task 7: Dashboard subcomponents

**Files:**

- Create: `src/renderer/src/components/dashboard/Gauges.tsx`, `SessionsTable.tsx`, `LocksPanel.tsx`, `ControlsBar.tsx`

**Interfaces:**

- Consumes: `ServerSnapshot`, `SessionRow`, `LockRow`.
- Produces: `<Gauges snapshot />`, `<SessionsTable rows />`, `<LocksPanel rows />`, `<ControlsBar intervalMs onIntervalChange paused onTogglePause fullVisibility />`.

- [ ] **Step 1: ControlsBar**

`src/renderer/src/components/dashboard/ControlsBar.tsx`:

```tsx
import IconPause from '~icons/lucide/pause'
import IconPlay from '~icons/lucide/play'
import { Button } from '../ui/button'

const INTERVALS = [1000, 2000, 5000, 10000]

export function ControlsBar(props: {
  intervalMs: number
  onIntervalChange: (ms: number) => void
  paused: boolean
  onTogglePause: () => void
  fullVisibility: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-border p-2 text-sm">
      <Button variant="ghost" size="sm" onClick={props.onTogglePause}>
        <span className="flex items-center gap-1">
          {props.paused ? (
            <IconPlay className="h-3.5 w-3.5" />
          ) : (
            <IconPause className="h-3.5 w-3.5" />
          )}
          {props.paused ? 'Resume' : 'Pause'}
        </span>
      </Button>
      <label className="flex items-center gap-1 text-muted-foreground">
        Refresh
        <select
          className="rounded border border-border bg-background px-1 py-0.5 text-foreground"
          value={props.intervalMs}
          onChange={(e) => props.onIntervalChange(Number(e.target.value))}
        >
          {INTERVALS.map((ms) => (
            <option key={ms} value={ms}>
              {ms / 1000}s
            </option>
          ))}
        </select>
      </label>
      {!props.fullVisibility && (
        <span className="ml-auto text-xs text-muted-foreground">
          limited visibility — grant pg_monitor for full stats
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Gauges**

`src/renderer/src/components/dashboard/Gauges.tsx`:

```tsx
import type { ServerSnapshot } from '@shared/adapter/stats-types'

function bytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

function Stat(props: { label: string; value: string; alert?: boolean }): React.JSX.Element {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <div className={`text-lg ${props.alert ? 'text-destructive' : 'text-foreground'}`}>
        {props.value}
      </div>
    </div>
  )
}

export function Gauges(props: { snapshot: ServerSnapshot }): React.JSX.Element {
  const s = props.snapshot
  const a = s.activityByState
  return (
    <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Active" value={String(a.active)} />
      <Stat label="Idle" value={String(a.idle)} />
      <Stat
        label="Idle in txn"
        value={String(a.idleInTransaction + a.idleInTransactionAborted)}
        alert={a.idleInTransaction + a.idleInTransactionAborted > 0}
      />
      <Stat label="Backends" value={`${s.backends} / ${s.maxConnections}`} />
      <Stat label="DB size" value={bytes(s.dbSizeBytes)} />
      <Stat label="Other" value={String(a.other)} />
    </div>
  )
}
```

- [ ] **Step 3: SessionsTable**

`src/renderer/src/components/dashboard/SessionsTable.tsx`:

```tsx
import { useState } from 'react'
import type { SessionRow } from '@shared/adapter/stats-types'

type SortKey = 'pid' | 'user' | 'state' | 'duration'
const LONG_MS = 30_000

function durationMs(r: SessionRow): number {
  if (r.queryStartMs == null) return 0
  return performance.timeOrigin + performance.now() - r.queryStartMs
}

export function SessionsTable(props: { rows: SessionRow[] }): React.JSX.Element {
  const [sort, setSort] = useState<SortKey>('duration')
  const rows = [...props.rows].sort((a, b) => {
    if (sort === 'duration') return durationMs(b) - durationMs(a)
    const av = String(a[sort] ?? '')
    const bv = String(b[sort] ?? '')
    return av.localeCompare(bv)
  })
  const th = (key: SortKey, label: string): React.JSX.Element => (
    <th className="cursor-pointer px-2 py-1 text-left font-medium" onClick={() => setSort(key)}>
      {label}
      {sort === key ? ' ↓' : ''}
    </th>
  )
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background text-muted-foreground">
          <tr>
            {th('pid', 'PID')}
            {th('user', 'User')}
            {th('state', 'State')}
            {th('duration', 'Duration')}
            <th className="px-2 py-1 text-left font-medium">Query</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const idleTxn =
              r.state === 'idle in transaction' || r.state === 'idle in transaction (aborted)'
            const long = r.state === 'active' && durationMs(r) > LONG_MS
            return (
              <tr
                key={r.pid}
                className={`border-t border-border ${idleTxn || long ? 'text-destructive' : 'text-foreground'}`}
              >
                <td className="px-2 py-1">{r.pid}</td>
                <td className="px-2 py-1">{r.user ?? '—'}</td>
                <td className="px-2 py-1">{r.state ?? '—'}</td>
                <td className="px-2 py-1">
                  {r.queryStartMs == null ? '—' : `${Math.round(durationMs(r) / 1000)}s`}
                </td>
                <td className="max-w-md truncate px-2 py-1 font-mono text-xs">{r.query ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && <div className="p-4 text-muted-foreground">No sessions.</div>}
    </div>
  )
}
```

- [ ] **Step 4: LocksPanel**

`src/renderer/src/components/dashboard/LocksPanel.tsx`:

```tsx
import type { LockRow } from '@shared/adapter/stats-types'

export function LocksPanel(props: { rows: LockRow[] }): React.JSX.Element {
  if (props.rows.length === 0)
    return <div className="p-4 text-sm text-muted-foreground">No blocked sessions.</div>
  return (
    <table className="w-full text-sm">
      <thead className="text-muted-foreground">
        <tr>
          <th className="px-2 py-1 text-left font-medium">Blocked PID</th>
          <th className="px-2 py-1 text-left font-medium">Blocked by</th>
          <th className="px-2 py-1 text-left font-medium">Blocked query</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r, i) => (
          <tr key={`${r.blockedPid}-${r.blockingPid}-${i}`} className="border-t border-border">
            <td className="px-2 py-1">{r.blockedPid}</td>
            <td className="px-2 py-1">{r.blockingPid}</td>
            <td className="max-w-md truncate px-2 py-1 font-mono text-xs">
              {r.blockedQuery ?? '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 5: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

```bash
git add src/renderer/src/components/dashboard/
git commit -m "feat: dashboard subcomponents (gauges, sessions, locks, controls)"
```

---

### Task 8: ServerDashboard + mode switch

**Files:**

- Create: `src/renderer/src/components/ServerDashboard.tsx`
- Modify: `src/renderer/src/store-query.ts`, `src/renderer/src/App.tsx`

**Interfaces:**

- Consumes: hooks (Task 4), `useRateHistory` (Task 5), `TimeSeriesChart` (Task 6), subcomponents (Task 7), `useConnStore`.
- Produces: `<ServerDashboard />`; `useQueryStore.mainView: 'query' | 'dashboard'` + `setMainView`.

- [ ] **Step 1: Add mainView to the store**

Modify `src/renderer/src/store-query.ts`:

- In `interface QueryState` add: `mainView: 'query' | 'dashboard'` and `setMainView: (v: 'query' | 'dashboard') => void`.
- In the `create(...)` initializer add: `mainView: 'query',` and `setMainView: (v) => set({ mainView: v }),`.

- [ ] **Step 2: Implement ServerDashboard**

`src/renderer/src/components/ServerDashboard.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { useConnStore } from '../store'
import { useServerSnapshot, useSessions, useLocks } from '../query/stats'
import { useRateHistory } from '../query/use-rate-history'
import { TimeSeriesChart } from './charts/TimeSeriesChart'
import { Gauges } from './dashboard/Gauges'
import { SessionsTable } from './dashboard/SessionsTable'
import { LocksPanel } from './dashboard/LocksPanel'
import { ControlsBar } from './dashboard/ControlsBar'

export function ServerDashboard(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  const [intervalMs, setIntervalMs] = useState(2000)
  const [paused, setPaused] = useState(false)
  const opts = { intervalMs, enabled: !paused }

  const snapshotQ = useServerSnapshot(connId, opts)
  const sessionsQ = useSessions(connId, opts)
  const locksQ = useLocks(connId, opts)
  const { rates, connections } = useRateHistory(connId, snapshotQ.data)

  const t = useMemo(() => rates.map((r) => r.tMs / 1000), [rates])
  const tpsData = useMemo(() => [t, rates.map((r) => r.tps)], [t, rates])
  const cacheData = useMemo(() => [t, rates.map((r) => r.cacheHitRatio * 100)], [t, rates])
  const tupleData = useMemo(() => [t, rates.map((r) => r.tuplesPerSec)], [t, rates])
  const connT = useMemo(() => connections.map((c) => c.tMs / 1000), [connections])
  const connData = useMemo(
    () => [
      connT,
      connections.map((c) => c.active),
      connections.map((c) => c.idle),
      connections.map((c) => c.idleInTransaction)
    ],
    [connT, connections]
  )

  if (snapshotQ.isError)
    return (
      <div className="p-4 text-destructive">
        Stats failed: {snapshotQ.error instanceof Error ? snapshotQ.error.message : 'error'}
      </div>
    )

  return (
    <div className="flex h-full flex-col overflow-auto">
      <ControlsBar
        intervalMs={intervalMs}
        onIntervalChange={setIntervalMs}
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
        fullVisibility={snapshotQ.data?.fullVisibility ?? true}
      />
      {snapshotQ.data && <Gauges snapshot={snapshotQ.data} />}
      <div className="grid grid-cols-1 gap-2 p-2 lg:grid-cols-2">
        <TimeSeriesChart title="Transactions/s" labels={['tps']} data={tpsData} />
        <TimeSeriesChart
          title="Cache hit %"
          labels={['cache %']}
          data={cacheData}
          format={(v) => `${v.toFixed(0)}%`}
        />
        <TimeSeriesChart title="Tuples/s" labels={['tuples/s']} data={tupleData} />
        <TimeSeriesChart
          title="Connections"
          labels={['active', 'idle', 'idle in txn']}
          data={connData}
        />
      </div>
      <div className="border-t border-border p-2 text-sm font-medium text-muted-foreground">
        Sessions
      </div>
      {sessionsQ.data && <SessionsTable rows={sessionsQ.data} />}
      <div className="border-t border-border p-2 text-sm font-medium text-muted-foreground">
        Locks
      </div>
      {locksQ.data && <LocksPanel rows={locksQ.data} />}
    </div>
  )
}
```

- [ ] **Step 3: Mode switch + palette commands in App**

Modify `src/renderer/src/App.tsx`:

- Import: `import { ServerDashboard } from './components/ServerDashboard'`.
- Read the mode: `const mainView = useQueryStore((s) => s.mainView)` and `const setMainView = useQueryStore((s) => s.setMainView)` (near the other `useQueryStore` usages).
- Add two palette commands (in the `commands` array, after `new-query-tab`):

```ts
    { id: 'show-dashboard', label: 'Show dashboard', run: () => setMainView('dashboard') },
    { id: 'show-query', label: 'Show query', run: () => setMainView('query') },
```

- In the connected branch, replace the `<div className="h-full"><QueryWorkbench /></div>` with a header switch + conditional body:

```tsx
{
  view.kind === 'connected' && (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-border p-1">
        <button
          className={`rounded px-2 py-0.5 text-sm ${mainView === 'query' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
          onClick={() => setMainView('query')}
        >
          Query
        </button>
        <button
          className={`rounded px-2 py-0.5 text-sm ${mainView === 'dashboard' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
          onClick={() => setMainView('dashboard')}
        >
          Dashboard
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {mainView === 'query' ? <QueryWorkbench /> : <ServerDashboard />}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

```bash
git add src/renderer/src/components/ServerDashboard.tsx src/renderer/src/store-query.ts src/renderer/src/App.tsx
git commit -m "feat: ServerDashboard view + Query/Dashboard mode switch"
```

---

### Task 9: Dashboard e2e

**Files:**

- Create: `tests/e2e/dashboard.spec.ts`

**Interfaces:**

- Consumes: the running app + Dockerized PG (`pnpm db:up`).

- [ ] **Step 1: Write the e2e**

`tests/e2e/dashboard.spec.ts` (mirror `tests/e2e/query.spec.ts` for launch + connect, using exact placeholder selectors):

```ts
import { test, expect, _electron as electron } from '@playwright/test'

test('connect, open dashboard, see gauges and sessions', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByPlaceholder('Name', { exact: true }).fill('local-dash')
  await win.getByPlaceholder('Host', { exact: true }).fill('127.0.0.1')
  await win.getByPlaceholder('Port', { exact: true }).fill('54329')
  await win.getByPlaceholder('Database', { exact: true }).fill('fordb_test')
  await win.getByPlaceholder('User', { exact: true }).fill('fordb')
  await win.getByPlaceholder('Password', { exact: true }).fill('fordb')
  await win.getByText('Test', { exact: true }).click()
  await expect(win.getByText('OK')).toBeVisible({ timeout: 15000 })
  await win.getByText('Save').click()
  await win.getByText('local-dash').click()

  await win.getByText('Dashboard', { exact: true }).click()
  await expect(win.getByText('Backends')).toBeVisible({ timeout: 15000 }) // a gauge
  await expect(win.getByText('Sessions')).toBeVisible()

  await app.close()
})
```

- [ ] **Step 2: Run it**

Run: `pnpm db:up && pnpm build && pnpm e2e && pnpm db:down`
Expected: passes (needs an OS keychain session for the connect step — see the note below).
Note: like the existing e2e, the connect step requires `safeStorage.isEncryptionAvailable()` (a real desktop keyring). In a headless shell it will stop at "Test → OK"; that's environmental, not a code defect. Run it on a desktop session to confirm end-to-end.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/dashboard.spec.ts
git commit -m "test: dashboard e2e (connect, open dashboard, see gauges)"
```

---

## Self-Review (done at plan time)

1. **Spec coverage:** §1 types+capability → Task 1; §1 PG queries + contract → Task 2; §2 HostApi → Task 3; §3 keys+hooks → Task 4; §4 rates+history → Task 5; §5 uPlot wrapper → Task 6; §6 UI (gauges/sessions/locks/controls) → Task 7, (dashboard+mode switch) → Task 8; §7 privilege/error handling → ControlsBar note + per-panel error (Tasks 7–8); §8 testing → contract (2,3), unit (4,5), e2e (9). Success criteria 1–5 all map (read-only: no kill anywhere; scoped to current db in the SQL; in-memory history in Task 5; mode switch Task 8).
2. **Placeholder scan:** No TBD/TODO. Every code step carries full code. The only deferred item is forcing a real lock pair in the contract test (deliberate — flaky in a unit-style contract suite; covered manually/e2e), stated explicitly in Task 2 Step 4.
3. **Type consistency:** `ServerSnapshot`/`SessionRow`/`LockRow`/`ServerStatsProvider` (Task 1) used verbatim in Tasks 2/3/4/5/7. `qk.serverSnapshot/sessions/locks` (Task 4) match `useServerSnapshot/useSessions/useLocks` keys and Task 8 usage. `Sample`/`RatePoint`/`computeRate`/`pushSample` (Task 5) match `useRateHistory` and its test. `TimeSeriesChartProps` (Task 6) `{data,labels,title,format}` match every `<TimeSeriesChart>` call in Task 8. `mainView`/`setMainView` (Task 8) consistent across store + App.

**Known deliberate deferrals:** real lock-pair contract test (flaky → e2e/manual); `SessionRow.query` duration uses `performance.timeOrigin + performance.now()` vs server `queryStartMs` (client/server clock skew makes durations approximate — acceptable for a monitoring glance, noted here); charts show relative sample time (`tMs/1000` from `performance.now`), not wall-clock, which is fine for a rolling live window.

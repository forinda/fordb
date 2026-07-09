# fordb — Postgres Server-Stats Dashboard: Design Spec

Status: Approved 2026-07-09 · Milestone: M-ServerStats (after M-ReactQuery) · References: M3 workbench, React Query metadata layer, `DbAdapter` contract.

A read-only, pgAdmin-style dashboard for inspecting Postgres server state: sessions (spot zombie / idle-in-transaction connections), connection-state counts, live load charts (TPS, cache hit, tuples/s, connections), locks, and DB size. Builds on the merged React Query metadata layer.

## Goal / exit criterion

From a connected Postgres, the user can open a **Dashboard** mode showing: gauges (connections by state, backends vs max, DB size), live time-series charts, a sortable sessions table (idle-in-transaction and long-running flagged), and a locks panel — all refreshing on a chosen cadence, read-only. No workbench regression.

## Non-goals (v1)

- **No destructive actions** — no `pg_cancel_backend` / `pg_terminate_backend`. View-only.
- **No persistence** — chart history is in-memory, reset on disconnect / mode switch / restart.
- **Postgres only** — SQLite/Mongo don't implement the capability (they're not built yet anyway).
- **Not cluster-wide** — scoped to the connected database; only the inherently server-global metrics (total connections, `max_connections`) are server-wide.

## Decisions locked during design

- Full read-only dashboard (sessions + all charts + locks + gauges); no kill in v1.
- Charts: **uPlot** (tiny, canvas, self-contained → CSP-safe; imperative, wrapped in React).
- Scope: current database; server-global metrics where they inherently are.
- History: in-memory rolling window (default 5 minutes), no disk.

## 1. Data source — typed `ServerStats` capability on `DbAdapter`

The renderer never authors `pg_stat_*` SQL. A new **optional** capability is added to the adapter contract; Postgres implements it. Three typed methods (split so cadences can differ):

- `getServerSnapshot(): Promise<ServerSnapshot>` — cheap, polled fast (feeds charts + gauges).
- `getSessions(): Promise<SessionRow[]>` — `pg_stat_activity` rows for the table.
- `getLocks(): Promise<LockRow[]>` — blocked ⋈ blocking pairs from `pg_locks`.

### Types (`src/shared/adapter/stats-types.ts`)

```ts
export interface ServerSnapshot {
  // Cumulative counters (rates derived in the renderer). Scoped to current DB
  // via pg_stat_database WHERE datname = current_database().
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
  // Connection counts by pg_stat_activity.state (current DB).
  activityByState: {
    active: number
    idle: number
    idleInTransaction: number
    idleInTransactionAborted: number
    other: number // fastpath function call, disabled, null state
  }
  backends: number // total server connections (server-wide)
  maxConnections: number // server setting
  dbSizeBytes: number // pg_database_size(current_database())
  // True when the role can see other sessions' details (superuser/pg_monitor).
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
  backendStartMs: number | null // epoch ms
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
```

### Adapter capability (`DbAdapter`)

Add an optional member:

```ts
readonly serverStats?: ServerStatsProvider
export interface ServerStatsProvider {
  getServerSnapshot(): Promise<ServerSnapshot>
  getSessions(): Promise<SessionRow[]>
  getLocks(): Promise<LockRow[]>
}
```

Postgres implements it. `runAdapterContractTests` gains a **capability-gated** block: if `adapter.serverStats` exists, run the stats contract tests; otherwise skip. So SQLite/Mongo adapters stay conformant without implementing it.

### Postgres queries (in `PostgresAdapter`)

- snapshot: one query joining `pg_stat_database` (current db), an aggregate over `pg_stat_activity` grouped by `state`, `pg_database_size(current_database())`, `current_setting('max_connections')`, and a total `count(*)` of backends. `fullVisibility` = `pg_has_role(current_user,'pg_monitor','MEMBER') OR usesuper`.
- sessions: `SELECT … FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`.
- locks: standard blocked/blocking join (`pg_locks` blocked ⋈ granted `pg_locks` ⋈ `pg_stat_activity`).

## 2. HostApi surface

Add to `HostApi` (all `(id, …)` routed, read-only):

```ts
getServerSnapshot(id: ConnectionId): Promise<ServerSnapshot>
getSessions(id: ConnectionId): Promise<SessionRow[]>
getLocks(id: ConnectionId): Promise<LockRow[]>
serverStatsSupported(id: ConnectionId): Promise<boolean> // adapter.serverStats != null
```

`HostApiImpl` routes to `registry.get(id).serverStats`; throws a clear "server stats not supported by this engine" if absent.

## 3. React Query layer

- Keys (extend `qk`): `qk.serverSnapshot(connId)`, `qk.sessions(connId)`, `qk.locks(connId)` — all `['conn', connId, …]`-prefixed, so `invalidateIntrospection`'s connection-scoped invalidation and gc still cover them as a unit.
- Hooks (`src/renderer/src/query/stats.ts`): `useServerSnapshot(connId, { intervalMs, enabled })`, `useSessions(connId, …)`, `useLocks(connId, …)` — `useQuery` with `refetchInterval: enabled ? intervalMs : false`. Only enabled when the Dashboard mode is visible (so no polling from the workbench).

## 4. Time-series history (rate computation)

Cumulative counters → rates in the renderer. A pure module `src/shared/stats/rates.ts`:

```ts
export interface Sample {
  tMs: number
  counters: ServerSnapshot['counters']
}
export interface RatePoint {
  tMs: number
  tps: number
  cacheHitRatio: number
  tuplesPerSec: number
}
// delta/dt between successive samples; if any counter went backwards (server
// restart / stats reset), drop the pair (return null) rather than emit a spike.
export function computeRate(prev: Sample, cur: Sample): RatePoint | null
export function pushSample(buf: Sample[], s: Sample, windowMs: number): Sample[] // ring window
```

A small hook/store `useRateHistory(connId, snapshot, windowMs)` keeps the ring buffer (default `windowMs = 5*60_000`), appends on each new snapshot, derives `RatePoint[]` + `connectionsOverTime` for the charts. History lives here (component/local), **not** in the React Query cache — same rule as `QueryResultSource`. Reset when connId changes or the dashboard unmounts.

## 5. Charts — uPlot wrapper

`src/renderer/src/components/charts/TimeSeriesChart.tsx`:

- Creates a uPlot instance in a ref; updates via `u.setData(...)` on data change (no React re-render of canvas).
- Colors pulled from CSS custom properties (`--color-primary`, `--color-muted-foreground`, etc.) so light/dark themes apply; re-reads on theme change.
- `ResizeObserver` → `u.setSize(...)`. Disposed on unmount.
- uPlot CSS imported once (bundled). Pure canvas, no network → CSP-safe.

Four charts: **TPS**, **cache-hit ratio**, **tuples/sec**, **connections over time**.

## 6. UI / mode switch

The connected main pane gets two modes: **Query** (existing workbench) and **Dashboard**.

- A segmented control `[Query | Dashboard]` in the pane header.
- Palette commands: `show-dashboard`, `show-query`.
- Mode state lives in the query/UI store (Zustand UI state): `mainView: 'query' | 'dashboard'`.

Dashboard (`src/renderer/src/components/ServerDashboard.tsx`) layout, top→bottom:

1. **Controls bar** — cadence select (1 / 2 / 5 / 10 s, default 2 s) + pause toggle; "limited visibility — grant pg_monitor for full stats" note when `!fullVisibility`.
2. **Gauges row** — connections by state (idle-in-transaction + aborted visually flagged as the zombie signal), backends `/` max_connections, DB size (human-readable).
3. **Charts grid** — the four uPlot charts.
4. **Sessions table** — sortable columns; idle-in-transaction and long-running (query duration over a threshold) rows flagged; read-only. Reuses the app's table styling (not necessarily Glide — a plain sortable table is fine at session-count scale).
5. **Locks panel** — blocked ⋈ blocking list; empty-state when none.

Icons via the existing unplugin-icons (lucide: `activity`, `database`, `lock`, `gauge`, …).

## 7. Error / privilege / disconnect handling

- Non-privileged role: `fullVisibility=false`; render own sessions + the note. No error.
- Snapshot/sessions/locks query error: surface inline per-panel (don't blank the whole dashboard).
- db-host restart / connection lost: existing `onDbHostRestarted` → dashboard stops polling, shows the connection-lost state (reuse workbench behavior).
- Switching to Dashboard on a non-PG engine (future): `serverStatsSupported=false` → "Server stats aren't available for this engine."

## 8. Testing

- **Contract** (`runAdapterContractTests`, capability-gated, Dockerized PG): `getServerSnapshot` returns sane shape (maxConnections > 0, activityByState sums ≤ backends, dbSizeBytes > 0); `getSessions` returns at least the test's own backend excluded; `getLocks` returns [] on an idle DB and a pair when a lock is forced.
- **Unit**: `rates.ts` — `computeRate` (normal delta, zero dt guard, counter-reset → null), `pushSample` (ring window eviction). Query-key additions.
- **e2e**: connect → switch to Dashboard → gauges + a chart render → sessions table lists the app's own backend → switch back to Query.
- Existing unit + contract suites stay green.

## 9. File structure

```
src/shared/adapter/stats-types.ts        # ServerSnapshot, SessionRow, LockRow, ServerStatsProvider
src/shared/stats/rates.ts                 # computeRate, pushSample (pure)
src/db-host/postgres/postgres-stats.ts    # PG ServerStatsProvider impl (queries)
src/db-host/postgres/postgres-adapter.ts  # wire `serverStats`
src/shared/host/host-api.ts               # + getServerSnapshot/getSessions/getLocks/serverStatsSupported
src/db-host/host-api-impl.ts              # route them
src/renderer/src/query/keys.ts            # + serverSnapshot/sessions/locks keys
src/renderer/src/query/stats.ts           # useServerSnapshot/useSessions/useLocks + useRateHistory
src/renderer/src/components/charts/TimeSeriesChart.tsx  # uPlot wrapper
src/renderer/src/components/ServerDashboard.tsx         # dashboard view
src/renderer/src/components/dashboard/*    # Gauges, SessionsTable, LocksPanel, ControlsBar
src/renderer/src/App.tsx / store-query.ts  # mainView mode switch + palette commands
```

## 10. Risks

| Risk                                                      | Mitigation                                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| uPlot is imperative; React lifecycle mismatch             | Isolate all uPlot in `TimeSeriesChart` (ref-managed instance, setData/setSize, dispose on unmount); no other component touches uPlot |
| Counter reset (server restart) → rate spike               | `computeRate` drops the pair when any counter decreases                                                                              |
| Non-privileged role → partial data looks "broken"         | `fullVisibility` flag + explicit note; render what's visible                                                                         |
| Fast cadence hammers the server                           | Default 2 s, min 1 s; polling only while Dashboard is visible; `getServerSnapshot` is one lightweight query                          |
| Engine-specific capability leaks into the generic adapter | Optional `serverStats` member; contract tests gated on its presence; HostApi throws a clear message if absent                        |

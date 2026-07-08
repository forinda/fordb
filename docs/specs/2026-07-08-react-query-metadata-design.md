# fordb — React Query for the Metadata Layer: Design Spec

Status: Approved 2026-07-08 · Milestone: M-ReactQuery (after M3) · References: M3 query workbench, docs/04-ui-stack.md.

Builds on merged M2/M-Appearance/M3. Moves introspection + profile fetching onto TanStack Query; query _results_ stay on `QueryResultSource`.

## Goal / exit criterion

Introspection (schemas/tables/columns) and the profile list are served by TanStack Query — deduped across the schema tree and the SQL autocomplete, cached per connection, loaded per-node lazily, and invalidatable via an explicit "Refresh schema" action. No behavioral regression to the workbench.

## Non-goals (unchanged / deferred)

Query results stay on `QueryResultSource` (a stateful server cursor — wrong fit for React Query's key-based cache). The deferred M3 minors (cancel→idle race, reconnect affordance, App IPC-subscription cleanup) are out of scope here.

## 1. Foundation

- Dependency: `@tanstack/react-query`.
- One `QueryClient` (`src/renderer/src/query/client.ts`) with defaults suited to a desktop app: `staleTime: 5 * 60_000`, `gcTime: 30 * 60_000`, `retry: 1`, `refetchOnWindowFocus: false`, `refetchOnReconnect: false`.
- `QueryClientProvider` wraps `<App/>` in `src/renderer/src/main.tsx`.
- **Query-key factory** (`src/renderer/src/query/keys.ts`): `qk.profiles()`, `qk.schemas(connId)`, `qk.tables(connId, schema)`, `qk.columns(connId, schema, table)`. Every connection-scoped key begins with `['conn', connId, …]` so a connection's metadata is invalidated/collected as a unit.

## 2. Introspection hooks (`src/renderer/src/query/introspection.ts`)

- `useSchemas(connId: string | null)` → `useQuery({ queryKey: qk.schemas(connId!), queryFn: () => api.listSchemas(connId!), enabled: !!connId })` (via `hostApi()`).
- `useTables(connId, schema)` and `useColumns(connId, schema, table)` — same shape, `enabled` only when their inputs exist.
- `fetchColumns(qc: QueryClient, connId, schema, table): Promise<ColumnInfo[]>` — a `queryClient.fetchQuery` variant (non-hook) for the completion source; shares the exact cache entry as `useColumns` (same key), so tree and autocomplete dedup.
- `invalidateIntrospection(qc: QueryClient, connId): Promise<void>` — `qc.invalidateQueries({ queryKey: ['conn', connId] })`; the single "refresh this connection's metadata" primitive.

## 3. Schema tree → per-node lazy

Rework `SchemaTree` (react-arborist) to load children on expand rather than eager-loading everything on connect:

- Root renders schemas from `useSchemas(connId)`.
- The tree data is assembled from cache: a schema node's `children` come from `useTables(connId, schema)` (fetched when the schema is first expanded); a table node's columns from `useColumns`.
- Implementation: maintain the set of expanded schema/table keys in local state; render react-arborist `data` built from whatever is currently cached/loading, and trigger the corresponding `useQuery` (via `enabled` gated on expansion). Loading nodes show a placeholder child.
- Result: a big schema no longer blocks first paint; one table refreshes without re-introspecting the rest. Retires the M3 eager-load.

## 4. Autocomplete → lazy columns, shared cache

`completion.ts` drops its hand-rolled `Map`. The CodeMirror completion becomes a **custom `CompletionSource`**:

- Schema/table name completions come from cache (`qc.fetchQuery(qk.schemas/…tables)`).
- When the token context is `table.` (or `schema.table.`), it calls `fetchColumns(qc, connId, schema, table)` — the same cache entry the tree fills, so expanding a table in the tree warms autocomplete and vice-versa.
- The source is registered on the editor with the active `connId` and the shared `QueryClient`. No eager full-namespace build.
- Known limit (documented): alias resolution (`SELECT u.… FROM users u`) is best-effort/deferred; direct `table.col` completion is the M-ReactQuery bar.

## 5. Profiles → useQuery

- `useProfiles()` (`useQuery({ queryKey: qk.profiles(), queryFn: () => window.fordb.profiles.list() })`) replaces the manual `useConnStore.loadProfiles`.
- `ConnectionList` reads `useProfiles()`. The profile save/delete flows call `qc.invalidateQueries({ queryKey: qk.profiles() })` so the list refreshes without manual reloads.
- The Zustand `profiles` + `loadProfiles` slice is **removed**; `activeConnectionId` / `setActive` / `clearActive` stay (UI state, not server state). Callers that did `useConnStore.getState().loadProfiles()` switch to invalidating the profiles query.

## 6. Refresh affordance

- A **"Refresh schema"** button in the sidebar + a command-palette command → `invalidateIntrospection(qc, activeConnectionId)`.
- Best-effort DDL awareness: after a non-SELECT `executeQuery` succeeds in the workbench, invalidate that connection's introspection (schema may have changed).

## 7. Testing

- **Query-key factory** unit test: keys are stable, correctly `['conn', connId, …]`-prefixed, and distinct per input.
- **invalidateIntrospection scoping** unit test: an invalidation for connA matches connA's keys and NOT connB's (test the key predicate / that `['conn', connA]` is a prefix of connA keys only).
- Existing 64 unit + 24 contract stay green (introspection HostApi contract unchanged).
- Hooks/components exercised by the e2e (no RTL harness in repo; not adding one here).
- **e2e**: connect → tree loads a schema's tables lazily on expand → autocomplete completes a column → "Refresh schema" triggers a refetch.

## 8. Success criteria

1. The schema tree and the SQL autocomplete share one cache — expanding a table in the tree means autocomplete has its columns without a second fetch (and vice-versa).
2. The tree loads a schema's children on expand, not all schemas' tables+columns on connect.
3. "Refresh schema" (button + command) re-fetches the active connection's introspection; a DDL run in the workbench invalidates it.
4. The profile list is a `useQuery`; saving/deleting a profile updates the list via invalidation, with the Zustand profiles slice removed.
5. No workbench regression; results still stream via `QueryResultSource`.

## 9. Risks

| Risk                                                                           | Mitigation                                                                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| react-arborist + lazy per-node data is fiddly (controlled expansion)           | Keep the tree data derivation pure (cache → node array); gate each `useQuery` by expansion; a loading placeholder child avoids empty-flash |
| Custom CodeMirror completion source is more code than lang-sql's schema option | Scope to `table.col` (defer alias resolution); reuse `fetchColumns` so it's a thin async lookup                                            |
| Removing the Zustand profiles slice breaks callers                             | Grep all `loadProfiles`/`profiles` store usages; replace with `useProfiles`/invalidation in the same change                                |
| Over-caching hides a real schema change                                        | 5-min staleTime + explicit refresh + DDL invalidation; documented that reconnect always re-introspects                                     |

## Decisions made during design (not asked)

- Remove the Zustand `profiles` slice (React Query owns server state; Zustand keeps UI state).
- Lazy per-table completion via a custom CodeMirror `CompletionSource` (not an eager lang-sql namespace) — consistent with the lazy tree.
- QueryClient defaults tuned for desktop (no focus/reconnect refetch).

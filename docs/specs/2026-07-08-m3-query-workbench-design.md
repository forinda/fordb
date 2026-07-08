# fordb M3 — Query Workbench: Design Spec

Status: Approved 2026-07-08 · Milestone: M3 (after M2 + M-Appearance) · References: docs/06-prd.md §5 (SQL editor, results grid, query cancel), docs/03-database-connectivity.md, docs/04-ui-stack.md.

Builds on merged M2 (connection manager; `ConnectionRegistry`, `HostApi`, adapter `executeQuery`/`openQuery`/`fetchPage`/`closeQuery`/`cancel`) and M-Appearance (token theming, shadcn primitives).

## Goal / exit criterion

Run SQL against a connection from a CodeMirror editor with schema-aware autocomplete, stream results into a virtualized grid that scrolls through 500k+ rows without freezing, cancel a running query, and export CSV/JSON — plus the infra so a query on a dead/reloaded connection surfaces an error instead of hanging.

## Non-goals (deferred)

Result cell editing (→ generated UPDATE/INSERT/DELETE), server-side sort/filter/pagination, multi-statement scripts with per-statement result sets, persisted saved-queries/history (in-memory only), full orphan-connection reaping on reload.

## 1. Backend — query methods on HostApi

M2's `HostApi` exposed only introspection; the `DbAdapter` query methods are not reachable by `connectionId`. Add to `HostApi` (each routed through `registry.get(connectionId)`):

- `executeQuery(connectionId, sql)` → `QueryResult` (`{fields, rows, rowCount, command}`) — buffered; for non-SELECT (INSERT/UPDATE/DDL) and tiny results.
- `openQuery(connectionId, sql, pageSize)` → `OpenQueryResult` (`{queryId, fields}`).
- `fetchPage(connectionId, queryId)` → `Page` (`{rows, done}`).
- `closeQuery(connectionId, queryId)` → `void`.
- `cancel(connectionId)` → `void` (cancels the connection's running statement).

The types already exist in `src/shared/adapter/types.ts`. Contract-tested against Dockerized Postgres (the adapter suite already covers streaming/cancel; add HostApi-routed coverage, including the 5000-row fixture stream and cancel).

## 2. Result loading — cursor-stream with paging

- **Statement classification**: the workbench inspects the SQL; a SELECT-like statement (starts with `select`/`with`, case-insensitive, after trimming comments) → `openQuery` (cursor). Otherwise → `executeQuery` (buffered), display `rowCount`/`command` (e.g. "UPDATE 3").
- **`QueryResultSource`** (renderer): wraps one `queryId`. Holds fetched pages in order; exposes `fields`, `loadedRowCount`, `getRow(i)`, `done`, and `ensureLoaded(uptoIndex)` which calls `fetchPage` when the grid scrolls near the loaded edge (infinite scroll). Never fetches past `done`. `dispose()` calls `closeQuery`.
- Lifecycle: a new run in a tab disposes the tab's previous source; closing a tab disposes it; a connection-lost event disposes all sources for that connection.
- **Sort/filter** in M3 are client-side over loaded rows only (documented limit; server-side ORDER BY is a follow-up). Sorting triggers a full drain (fetch remaining pages) so the sort is over the complete set, with a row cap + banner if the set is very large.

## 3. UI — the workbench (renderer)

- **Query tabs**: multiple editor tabs scoped to the active connection; each tab owns `{ sql, source?, status }`. Tab + workbench state in a Zustand store (`useQueryStore`). Opening the workbench is the `connected` view (replaces M2's bare schema tree — tree moves to the sidebar alongside the editor).
- **SQL editor**: CodeMirror 6 + `@codemirror/lang-sql` (Postgres dialect). **Schema-aware autocomplete**: fed the active connection's schemas/tables/columns via `HostApi` introspection through a `SchemaCompletionProvider` — schemas and tables eagerly (already loaded for the tree), columns lazily per-table on first completion, cached per connection. Editor themed via M-Appearance tokens (a CodeMirror theme mapping to the CSS token vars, light/dark).
- **Run controls**: run-all, run-selection, run-statement-at-cursor (Ctrl/Cmd+Enter runs selection if any, else the statement at the cursor). **Cancel** button + shortcut → `HostApi.cancel(connectionId)`; disabled unless a query is running.
- **Results grid**: **Glide Data Grid** (canvas, virtualized, MIT) backed by `QueryResultSource` via its `getCellContent` region API → `source.getRow`/`ensureLoaded`. Columns from `fields`; cell copy; client-side column sort (drain-then-sort). Empty/loading/error states. Status bar: rows loaded, `done` flag, elapsed ms.
- **Export**: CSV + JSON of loaded rows (banner when the cursor isn't fully drained); "Export all" drains the cursor first. Export runs in the renderer over the source's rows.
- **Command palette**: "Run query", "Cancel query", "New query tab", "Close query tab".

## 4. Infra carry-forwards (workbench-critical only)

- **Per-RPC-call timeout**: `createRpcClient` gains an optional per-call timeout (default generous but finite, e.g. configurable ~60s; introspection/short calls use it, long `fetchPage` may use a longer bound). A pending call rejects with a timeout error if no response arrives, so a call to a hung/dead db-host surfaces instead of awaiting forever. Explicit `cancel` is separate and unaffected.
- **Connection-lost signal**: on `dbHost.on('exit')`, main emits an IPC event (`appearance`-style broadcast, e.g. `db-host:restarted`). The renderer marks all connections lost, disposes open `QueryResultSource`s, and the workbench shows "Connection lost — reconnect" instead of hanging. This layers an explicit signal over the browser `MessagePort` (which has no close event — the M2 review's exact gap).
- Full orphan-reaping of pg connections/tunnels on window reload stays deferred (hygiene, not workbench-blocking).

## 5. Read-only results

Run / view / scroll / sort / copy / export. No cell editing in M3.

## 6. Testing

- **HostApi query routing** (contract, Docker Postgres): executeQuery/openQuery/fetchPage/closeQuery/cancel by connectionId; the 5000-row streaming path; cancel interrupts.
- **QueryResultSource** (unit, fake HostApi): paging math, `done` handling, `ensureLoaded` fetch triggering, `dispose` → closeQuery, drain-for-sort.
- **Statement classification** (unit, pure): SELECT/WITH vs DML/DDL, comment handling.
- **createRpcClient timeout** (unit): a never-answered call rejects after the bound; a timely call resolves normally; existing RPC tests stay green.
- **Playwright** (desktop/keyring-CI): connect → type `SELECT ... FROM app.users` → run → grid shows rows → cancel a `pg_sleep` query → UI recovers.

## 7. Success criteria

1. A SELECT returning 500k rows: first page appears fast, scrolling loads more, UI stays responsive (virtualized, streamed).
2. Schema-aware completion completes schema → table → column for the active connection.
3. Cancel stops a running query; the UI returns to idle and the connection stays usable.
4. A query issued after db-host dies surfaces an error (timeout or connection-lost) — never hangs.
5. CSV and JSON export of results.

## 8. Risks

| Risk                                                        | Mitigation                                                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Glide Data Grid maintenance stalled (last release Feb 2024) | Back the grid with our own `QueryResultSource` interface so the grid is a swappable view; TanStack Virtual fallback if needed                   |
| Cursor lifecycle leaks (unclosed queryId on tab churn)      | `QueryResultSource.dispose()` on every teardown path (new run, tab close, connection lost); a contract test asserts closeQuery frees the cursor |
| Timeout too aggressive kills legitimately long queries      | Generous finite default; fetchPage uses a longer bound; user cancel is the primary stop, timeout is the safety net                              |
| Client-side sort drains huge cursors into memory            | Row cap + banner; server-side ORDER BY deferred and documented                                                                                  |
| CodeMirror theme drift from tokens                          | Map the CM theme to the same CSS token vars; switch with the `.dark` class                                                                      |

## Decisions made during design (not asked)

- **Glide Data Grid** for the grid (research pick; TanStack Virtual fallback behind the `QueryResultSource` seam).
- **Client-side sort over loaded rows** (drain-then-sort) for M3; server-side ORDER BY deferred.
- Ctrl/Cmd+Enter = run selection if present else statement-at-cursor.

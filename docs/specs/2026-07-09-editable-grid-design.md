# fordb — MA1: Editable Data Grid: Design Spec

Status: Approved 2026-07-09 · Milestone: MA1 (administrator-client roadmap) · References: DbAdapter contract + capability pattern (serverStats), Glide results grid, Postgres + SQLite adapters.

Turns the read-only results grid into an editable **table-data view**: inline cell edit, insert row, delete row — accumulated as a pending change set, previewed as SQL, applied in one transaction. The single biggest gap vs every competitor.

## Goal / exit criterion

From the schema tree, open a table's data, edit cell values / insert / delete rows, review the generated SQL, and apply it transactionally to Postgres or SQLite — values bound (never interpolated), rollback on error. No PK/unique key → the grid is read-only with a note. No regression to the query workbench.

## Non-goals (v1)

- Editing free-form **query results** (joins/expressions can't map back to one table) — only the single-table data view is editable.
- Type-specific editors (date/enum pickers), **FK-value dropdowns** (that's MA2), blob upload, multi-table edits, bulk paste/import (MA5).
- Editing a table with no primary or unique key (read-only + note).
- MongoDB (later — document-shaped mutator).

## Decisions locked during design

- **DataMutator** adapter capability; values **bound-parameterized**, identifiers quoted.
- Surface: a **data tab** in the workbench (query tabs gain `kind: 'query' | 'data'`).
- Apply model: **batched → preview → one transaction** (rollback on error).
- PK-less tables: **read-only + note**.
- **Explicit NULL** control (NULL ≠ empty string).

## 1. Capability — `DataMutator` (`src/shared/adapter/mutation-types.ts`)

```ts
export interface Cell {
  column: string
  value: unknown // string | number | boolean | null
}
export type RowEdit =
  | { kind: 'update'; schema: string; table: string; pk: Cell[]; set: Cell[] }
  | { kind: 'insert'; schema: string; table: string; values: Cell[] }
  | { kind: 'delete'; schema: string; table: string; pk: Cell[] }

/** Optional write capability. Engines that can't (or won't) mutate omit it. */
export interface DataMutator {
  /** Human-readable SQL for the confirm dialog — values inlined for DISPLAY only
   *  (never executed). One string per edit, in order. */
  preview(edits: RowEdit[]): string[]
  /** Apply all edits in a single transaction with BOUND values; rolls back on
   *  any error. */
  apply(edits: RowEdit[]): Promise<void>
}
```

Add to `DbAdapter`: `readonly dataMutator?: DataMutator`.

- **PgDataMutator** (`src/db-host/postgres/postgres-mutator.ts`, `constructor(conn: () => pg.Client)`): builds `UPDATE "s"."t" SET "c1"=$1, … WHERE "pk1"=$n …`, `INSERT INTO "s"."t" ("c"…) VALUES ($1…)`, `DELETE FROM "s"."t" WHERE "pk"=$1 …`. `apply` runs `BEGIN` → each op with bound params → `COMMIT` (or `ROLLBACK` + rethrow) on the connection.
- **SqliteDataMutator** (`src/db-host/sqlite/sqlite-mutator.ts`, `constructor(conn: () => Client)`): same SQL with `?` placeholders; `apply` uses libsql `client.batch(stmts, 'write')` — transactional.
- **preview** (both): renders the SQL with values as literals for display — strings single-quoted with `''` escaping, `null` → `NULL`, numbers/booleans as literals. Identifiers quoted with `"…"` and embedded `"` doubled (reusing the SQLite escape approach; PG identical). Because `apply` binds and `preview` only displays, the executed statement is never the displayed string — no display-vs-exec injection.

## 2. HostApi

Add (routed like the stats methods, via a `mutator(id)` helper that throws "editing not supported by this engine" when absent):

```ts
mutationSupported(id: ConnectionId): Promise<boolean>
previewEdits(id: ConnectionId, edits: RowEdit[]): Promise<string[]>
applyEdits(id: ConnectionId, edits: RowEdit[]): Promise<void>
```

## 3. Pure edit-builder (`src/shared/mutation/build-edits.ts`)

Renderer-side pure logic, unit-tested:

- `buildEdits(state): RowEdit[]` — from the tab's pending state (edited cells keyed by row+column with the row's original PK values, inserted rows, deleted row PKs) produce the ordered `RowEdit[]`: one `update` per edited existing row (pk from the ORIGINAL row, `set` = changed cells), one `insert` per new row, one `delete` per removed row.
- `renderLiteral(value): string` — the display value renderer shared by both mutators' `preview` (kept here so preview text is engine-neutral for the value part; identifier quoting stays in each mutator).

## 4. Table-data tab (`store-query.ts` + `TableDataGrid.tsx`)

- `QueryTab` gains `kind: 'query' | 'data'`. A **data tab** additionally holds `{ schema, table, pkColumns: string[] }` and a `pending` edit state (edited cells, inserted rows, deleted rows).
- `openTable(schema, table)` store action: resolve `pkColumns` via `getKeys` (primary, else a unique key; else `[]` → read-only), create a data tab, run `SELECT * FROM "schema"."table"` through the existing `openQuery`/`QueryResultSource` paging, set it active.
- `SchemaTree`: activating a table node (Enter / double-click / an "Open data" palette command) calls `openTable`.
- `QueryWorkbench`: for a `data` tab render `<TableDataGrid tab />` instead of the SQL editor; for `query` tabs, unchanged.

`TableDataGrid`:

- Glide `DataEditor` with `allowOverlay: true` and `onCellEdited` → record the edit in `pending` (dirty cells styled; a "set NULL" affordance renders NULL as a dim `∅`/placeholder). Add-row appends a blank pending insert; select + Delete marks a pending delete.
- A toolbar: dirty count, **Review & apply**, **Discard**. `pkColumns.length === 0` → grid read-only + "No primary key — read only" note (no toolbar).
- **Review & apply** → `previewEdits(connId, buildEdits(pending))` → a dialog listing the SQL → confirm → `applyEdits(connId, …)` → on success re-run the SELECT (fresh `QueryResultSource`) + clear `pending`; on error show it, keep pending.

## 5. Security / correctness

- Values bound (`$n`/`?`) at apply — no value interpolation. Identifiers quoted + `"`-escaped.
- Every apply is one transaction (PG `BEGIN/COMMIT`, SQLite `batch(…, 'write')`) — partial failure rolls back.
- Destructive (any apply) is gated behind the review dialog showing exact SQL.
- PK-less → read-only (can't target a unique row).
- Editing a PK column is allowed; the `update`'s `WHERE` uses the row's ORIGINAL pk values.

## 6. Testing

- **Contract** (capability-gated, `runAdapterContractTests` extension): when `adapter.dataMutator` exists — `apply` an update (change a users row), an insert, and a delete against the fixture, then re-`getColumns`/`SELECT` to confirm each took and that a mid-batch failure rolls the whole set back; `preview` returns one string per edit containing the right verb + table. Runs for PG (Docker) and SQLite (local + sqld).
- **Unit**: `buildEdits` (dirty state → correct `RowEdit[]`, PK from original row, inserts/deletes) and `renderLiteral` (string escaping, NULL, number/bool).
- **e2e** (headless on SQLite — no keychain): open a table → edit a cell → Review & apply → confirm → value persisted after refresh.
- Existing unit + contract stay green.

## 7. File structure

```
src/shared/adapter/mutation-types.ts        # NEW: Cell, RowEdit, DataMutator
src/shared/adapter/db-adapter.ts            # MODIFY: dataMutator?
src/shared/mutation/build-edits.ts          # NEW: buildEdits + renderLiteral (pure)
src/db-host/postgres/postgres-mutator.ts    # NEW: PgDataMutator
src/db-host/postgres/postgres-adapter.ts    # MODIFY: readonly dataMutator
src/db-host/sqlite/sqlite-mutator.ts        # NEW: SqliteDataMutator
src/db-host/sqlite/sqlite-adapter.ts        # MODIFY: readonly dataMutator (+ expose the client)
src/shared/host/host-api.ts                 # MODIFY: mutationSupported/previewEdits/applyEdits
src/db-host/host-api-impl.ts                # MODIFY: route them
src/renderer/src/store-query.ts             # MODIFY: tab kind 'data' + openTable + pending edits
src/renderer/src/components/TableDataGrid.tsx  # NEW: editable grid + toolbar + review dialog
src/renderer/src/components/QueryWorkbench.tsx # MODIFY: render data tabs
src/renderer/src/components/SchemaTree.tsx  # MODIFY: table activation → openTable
tests/contract/adapter-contract.ts          # MODIFY: capability-gated mutator block
tests/unit/build-edits.test.ts              # NEW
tests/e2e/edit.spec.ts                      # NEW
```

## 8. Risks

| Risk                                                             | Mitigation                                                                                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Free-form query results tempt editing but can't map to one table | v1 edits ONLY the single-table data view; the workbench query grid stays read-only                                                        |
| Wrong-row targeting                                              | PK/unique required; PK-less read-only; `WHERE` uses original pk values; single transaction                                                |
| Injection via edited values                                      | Values bound at apply; `preview` is display-only and never executed                                                                       |
| store-query grows unwieldy with data-tab state                   | Keep `pending` edit state + `TableDataGrid` self-contained; store holds tab identity + PK, the grid owns the dirty set                    |
| Engine mutation differences (SQLite ALTER-less, batch modes)     | DataMutator is optional + capability-gated; each engine implements its own preview/apply; contract proves parity for the ops both support |

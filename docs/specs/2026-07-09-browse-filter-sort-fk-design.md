# fordb — MA2: Browse (Filter, Sort, FK Navigation): Design Spec

Status: Approved 2026-07-09 · Milestone: MA2 (administrator-client roadmap) · References: MA1 editable data grid, DbAdapter capability pattern (serverStats/dataMutator), Postgres + SQLite adapters, `quoteIdent`.

Extends the MA1 table-data tab with no-SQL browsing: a per-column filter row (WHERE), sortable headers (ORDER BY), and forward foreign-key navigation (click a FK value → open the referenced parent row). Values are bound-parameterized; the renderer sends structured filter/sort, never SQL.

## Goal / exit criterion

In a table's data tab: filter by any column (=, ≠, <, >, ≤, ≥, contains, is null / is not null), sort by clicking headers, and click a foreign-key value to open the referenced row in a new tab — on Postgres and SQLite, with bound values (a quote in a filter value can't inject). Default order is the primary key. No regression to editing.

## Non-goals (v1)

- **Reverse FK** ("rows that reference this row") — MA2b.
- **DB-wide value search** (find a value across all tables) — MA2b.
- OR / grouped filters (AND-only), expression/computed filters, per-column multi-filter.
- MongoDB (later — its own find/filter shape).

## Decisions locked during design

- A **`DataBrowser`** capability: `openBrowse(opts)` builds the engine-correct parameterized SELECT and returns a cursor (reuses `fetchPage`/`closeQuery`).
- **Per-column filter row** UI (op + value under each header).
- **Default sort = primary key** (as the data view already does); no PK → engine default order.
- Changing filter/sort with **pending edits → discard + confirm** (the row set changes).

## 1. Capability — `DataBrowser` (`src/shared/adapter/browse-types.ts`)

```ts
export type FilterOp = 'eq' | 'ne' | 'lt' | 'gt' | 'le' | 'ge' | 'contains' | 'isNull' | 'isNotNull'
export interface Filter {
  column: string
  op: FilterOp
  value?: unknown // absent for isNull/isNotNull
}
export interface Sort {
  column: string
  dir: 'asc' | 'desc'
}
export interface BrowseOptions {
  schema: string
  table: string
  filters: Filter[] // AND-joined
  sort: Sort[] // applied in order; empty → default pk order supplied by the caller
  pageSize: number
}

/** Optional structured-browse capability. Builds a parameterized SELECT and
 *  opens a cursor (paged via the existing fetchPage/closeQuery). */
export interface DataBrowser {
  openBrowse(opts: BrowseOptions): Promise<OpenQueryResult>
}
```

Add to `DbAdapter`: `readonly dataBrowser?: DataBrowser`.

## 2. The SQL builder (`src/shared/browse/build-browse.ts`, pure)

`buildBrowseSql(opts, dialect: 'pg' | 'sqlite'): { sql: string; params: unknown[] }`:

- `SELECT * FROM <qualified>` + (filters ? `WHERE` + filters joined `AND`) + (sort.length ? `ORDER BY` + sort joined `, ` : '').
- Placeholders: `pg` → `$1,$2,…`; `sqlite` → `?`. Identifiers via `quoteIdent` (reused from `@shared/mutation/build-edits`).
- Ops: `eq`→`= <ph>`, `ne`→`<> <ph>`, `lt/gt/le/ge`→`< / > / <= / >= <ph>`, `contains`→`LIKE <ph>` with the bound value wrapped `%value%`, `isNull`→`IS NULL` (no param), `isNotNull`→`IS NOT NULL` (no param).
- Sort item → `"col" ASC|DESC`.
- Every filter value is a **bound param** — never interpolated. Unit-tested including a value containing `'` and `"`.

## 3. Adapter implementations

- **PgDataBrowser** (`src/db-host/postgres/postgres-browser.ts`): `buildBrowseSql(opts,'pg')` → open a `pg-cursor` `new Cursor(sql, params, { rowMode: 'array' })` exactly like `openQuery`, register it in the existing cursor map, return `{ queryId, fields }`. (Refactor `openQuery`'s cursor-open into a shared private helper both use.)
- **SqliteDataBrowser** (`src/db-host/sqlite/sqlite-browser.ts`): `buildBrowseSql(opts,'sqlite')` → `client.execute({ sql, args })`, buffer rows + fields into the existing `Cursor` map (same as `openQuery`), return `{ queryId, fields }`.
- Wire `readonly dataBrowser` on both adapters. Both reuse the adapter's existing `fetchPage`/`closeQuery` — no new paging code.

## 4. HostApi

```ts
browseSupported(id: ConnectionId): Promise<boolean>
openBrowse(id: ConnectionId, opts: BrowseOptions): Promise<OpenQueryResult>
```

Routed via a `browser(id)` helper that throws when the engine lacks the capability. `fetchPage`/`closeQuery`/`cancel` unchanged.

## 5. Data tab + store

- `QueryTab.data` gains `browse: { filters: Filter[]; sort: Sort[] }` and `fkColumns: Record<string, { refTable: string }>` (from `getKeys` foreign keys; `column → referenced table`).
- `openTable(schema, table, initialFilters?)` — resolves PK (as today) + FKs; sets `browse = { filters: initialFilters ?? [], sort: pk ? pk.map(c => ({ column: c, dir: 'asc' })) : [] }`; runs the data tab.
- `run()` for a `data` tab calls `HostApi.openBrowse(connId, { schema, table, filters: browse.filters, sort: browse.sort, pageSize })` instead of the fixed `SELECT`. Query tabs unchanged.
- `setBrowse(tabId, browse)` — updates the tab's `browse` and re-runs (dispose old source). If the tab has pending edits (tracked in the grid), the grid confirms "discard N pending changes?" before calling `setBrowse` (see §6).

## 6. Grid (`TableDataGrid`)

- **Filter row:** a row of `{ op-select, value-input }` under the column headers (Glide's header region or a thin bar above the grid mapping to columns). Enter (or an Apply affordance) commits → builds `Filter[]` from non-empty entries → `setBrowse`. Empty value + non-null op is ignored; `isNull`/`isNotNull` need no value.
- **Sort:** clicking a column header cycles `asc → desc → unset` for that column and updates `sort` → `setBrowse`. The active sort shows an arrow. (Single-column sort in v1; the `Sort[]` type allows multi later.)
- **FK links:** columns in `fkColumns` render their value as a link (distinct color). Glide `onCellClicked` → if the column is a FK and the value is non-null → `openTable(schema, fkColumns[col].refTable, [{ column: <refPk>, op: 'eq', value }])`. The referenced PK is resolved in `openTable` via `getKeys(refTable)` (FK→PK assumption; if the referenced table has no single PK, fall back to opening it unfiltered).
- **Pending-edit guard:** before `setBrowse` (filter/sort change), if `dirty > 0`, `window.confirm('Discard N pending changes?')`; on confirm, clear pending then `setBrowse`; else cancel the change.

## 7. Security / correctness

- Filter values bound at execution (`$n`/`?`); only quoted identifiers interpolated. A quote in a value can't break out (unit + contract test).
- Column/table names come from introspection (`getColumns`/`getKeys`) and are quote-escaped.
- Default pk sort keeps the edit row-index mapping stable (MA1 relies on stable order within an execution).

## 8. Testing

- **Unit** (`build-browse.test.ts`): `buildBrowseSql` for both dialects — WHERE assembly per op, `contains` wrapping, `isNull`/`isNotNull` param-less, sort clause, placeholder numbering, quote-escaped idents, a value with `'`/`"` stays a param.
- **Contract** (capability-gated, PG + SQLite via `runAdapterContractTests`): `openBrowse` with an `eq` filter returns the matching rows; `contains` matches a substring; `isNull` matches; `sort desc` orders correctly; a filter value containing `'` returns 0 rows (bound, not injected — proves no injection). Reuses the shared fixture (users/orders).
- **e2e** (headless SQLite): open a table → set a column filter → the grid re-runs and the row count/first row reflects the filter (DOM-observable via the row-count marker / a known value). FK-click opens a new tab (assert the new tab appears).
- Existing unit + contract stay green.

## 9. File structure

```
src/shared/adapter/browse-types.ts           # NEW: Filter, Sort, BrowseOptions, DataBrowser
src/shared/adapter/db-adapter.ts             # MODIFY: readonly dataBrowser?
src/shared/browse/build-browse.ts            # NEW: buildBrowseSql (pure)
src/db-host/postgres/postgres-browser.ts     # NEW: PgDataBrowser
src/db-host/postgres/postgres-adapter.ts     # MODIFY: dataBrowser + shared cursor-open helper
src/db-host/sqlite/sqlite-browser.ts         # NEW: SqliteDataBrowser
src/db-host/sqlite/sqlite-adapter.ts         # MODIFY: dataBrowser + shared buffer helper
src/shared/host/host-api.ts                  # MODIFY: browseSupported/openBrowse
src/db-host/host-api-impl.ts                 # MODIFY: route them
src/renderer/src/store-query.ts              # MODIFY: data-tab browse state + fkColumns + openTable(initialFilters) + run-via-openBrowse + setBrowse
src/renderer/src/components/TableDataGrid.tsx # MODIFY: filter row, sortable headers, FK links, pending guard
tests/unit/build-browse.test.ts              # NEW
tests/contract/adapter-contract.ts           # MODIFY: capability-gated browse block
tests/e2e/browse.spec.ts                     # NEW
```

## 10. Risks

| Risk                                          | Mitigation                                                                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Placeholder style differs per engine          | The SQL is built engine-side (`buildBrowseSql` with a dialect); the renderer only sends structured `Filter[]`/`Sort[]`                                                      |
| Injection via filter values                   | Values bound (`$n`/`?`); a quote-in-value contract test proves it                                                                                                           |
| FK's referenced column unknown from `getKeys` | Assume FK→PK; resolve the referenced table's PK in `openTable`; if none, open unfiltered (documented)                                                                       |
| Changing filter/sort loses unsaved edits      | Confirm "discard N pending changes?" before re-running; MA1's pending set is cleared on confirm                                                                             |
| Glide filter-row / clickable-cell fiddliness  | Filter row can live in a thin bar above the grid (plain inputs) rather than Glide's header if the header API is awkward; acceptance is behavior, not the exact host element |

# M7 — MongoDB Engine (Design)

**Status:** approved scope (read + edit + stats), ready for plan
**Date:** 2026-07-10
**Milestone:** M7 (v0.3 — the free-Mongo wedge)

## Goal

Add MongoDB as a third engine alongside Postgres and SQLite: browse databases/collections, run find/aggregate queries against a document result surface, edit documents, and watch a Mongo server-status dashboard. Secrets stay in main; the connection is addressed by an opaque `connectionId`. Relational engines are untouched — MongoDB's document shape is isolated behind feature-detected capabilities.

## Core principle

MongoDB does not fit the relational contract (SQL-string in, positional `unknown[][]` out, schema→table→column). Rather than force-fit it, MongoDB **fills only the navigation core** of `DbAdapter` (so the existing schema tree + HostApi work unchanged) and routes its **query, results, editing, and stats through NEW feature-detected capabilities** that return documents. The renderer feature-detects `documentQuery` and swaps the query/result UI; Postgres and SQLite code paths do not change.

## Scope

### In (M7)

- **MongoProfile** — connection URI (primary) + discrete-field overrides; secret-safe via keychain.
- **MongoAdapter** (official `mongodb` driver) — navigation core: databases, collections, sampled fields, indexes; cursor cancel.
- **`documentQuery`** capability — `find` + `aggregate`, cursor-backed paging, cancel.
- **`documentMutator`** capability — insert / update-by-`_id` (`$set`) / delete-by-`_id`, previewed + confirmed.
- **`mongoStats`** capability — `serverStatus` snapshot + a Mongo dashboard.
- **Renderer** — connection form; JSON-mode query tab (find/aggregate); document-list results (Tree + Raw); document Edit/Delete/Insert; Mongo dashboard.
- **Contract** — a document-engine variant suite (`runDocumentAdapterContractTests`) against a Dockerized MongoDB + fixture.

### Out (later milestones)

- Mongo server administration (`currentOp`/`killOp`, users/roles) — a later admin milestone.
- Mongo views/`$out` materialization surfaced as objects.
- Schema validation (`$jsonSchema`) editing.
- Index create/drop UI (introspection only in M7).
- SQL-to-Mongo translation.

## Architecture

### Capability model (unchanged mechanism)

`DbAdapter` gains three optional `readonly X?` capabilities. Presence = supported; the renderer calls `XSupported(id)` first and hides what an engine can't do. Postgres/SQLite omit all three (fields simply not declared), exactly as they already omit `serverAdmin`/`serverStats`. MongoDB omits the relational capabilities (`dataMutator`, `dataBrowser`, `schemaEditor`, `objects`, `serverStats`, `serverAdmin`).

### Navigation core (`MongoAdapter` fills these so SchemaTree/HostApi work unchanged)

| `DbAdapter` method     | MongoDB mapping                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `connect/disconnect`   | `MongoClient` connect/close.                                                                                     |
| `listDatabases()`      | `admin().listDatabases()` → names.                                                                               |
| `listSchemas()`        | = `listDatabases()` (Mongo has no schema layer; collapses like SQLite).                                          |
| `listTables(db)`       | `db.listCollections()` → `TableInfo{schema:db,name,type}`; type `'view'` for Mongo views else `'table'`.        |
| `getColumns(db, coll)` | **sample N docs** (default 100), union top-level keys → `ColumnInfo{name,dataType:BSON-type,nullable:true,ordinal:i}`. Feeds tree + filter hints. |
| `getKeys(db, coll)`    | `[{ name:'_id_', kind:'unique', columns:['_id'] }]` — `_id` is the stable key for browse/edit; no FKs.           |
| `getIndexes(db, coll)` | `coll.listIndexes()` → `IndexInfo{name,columns,unique}`.                                                         |
| `executeQuery/openQuery(sql)` | **throw** `Error('MongoDB uses the document query surface, not SQL')`. The renderer never routes a document tab here. |
| `fetchPage/closeQuery` | throw as above (document paging lives on `documentQuery`).                                                       |
| `cancel()`             | close the active document cursor (no-op if none).                                                               |

`getColumns` type inference is best-effort: sample docs, for each top-level key record the first non-null BSON type seen (`string`, `int`, `double`, `objectId`, `date`, `bool`, `array`, `object`, `null`). Heterogeneous fields report the first-seen type; this is a hint, not a guarantee.

### `documentQuery` capability (`src/shared/adapter/document-types.ts`)

```ts
export interface FindOptions {
  projection?: Record<string, unknown>
  sort?: Record<string, 1 | -1>
  limit?: number
  skip?: number
}
export interface OpenDocsResult {
  queryId: string
}
export interface DocsPage {
  docs: Record<string, unknown>[]
  done: boolean
}
export interface DocumentQuery {
  find(coll: string, filter: Record<string, unknown>, opts: FindOptions, pageSize: number): Promise<OpenDocsResult>
  aggregate(coll: string, pipeline: Record<string, unknown>[], pageSize: number): Promise<OpenDocsResult>
  fetchDocs(queryId: string): Promise<DocsPage>
  closeDocs(queryId: string): Promise<void>
}
```

`find`/`aggregate` open a driver cursor (bounded by the connection's default database), stash it under a `queryId`, and eagerly fetch the first page (mirrors the PG cursor-prime pattern). `fetchDocs` pulls the next `pageSize` batch; `done` when the batch is short. `closeDocs` closes the cursor. `MongoAdapter.cancel()` closes whichever cursor is active. Documents cross the RPC boundary as EJSON-safe plain objects — the adapter serializes BSON (`ObjectId`, `Date`, `Long`, `Decimal128`, `Binary`) to a JSON-safe representation (relaxed EJSON) so the renderer receives structured, displayable values.

### `documentMutator` capability (`src/shared/adapter/document-types.ts`)

```ts
export interface DocumentMutator {
  insertOne(coll: string, doc: Record<string, unknown>): Promise<{ insertedId: unknown }>
  updateById(coll: string, id: unknown, patch: Record<string, unknown>): Promise<{ matched: number }>
  deleteById(coll: string, id: unknown): Promise<{ deleted: number }>
}
```

`updateById` applies `{ $set: patch }` to the doc matched by `_id`. `_id` is immutable — the renderer diffs the edited doc against the original, excludes `_id` from the patch, and rejects an `_id` change before calling. Insert accepts a full document (server generates `_id` if omitted). The renderer serializes the `_id` (string/ObjectId hex) back to a form the adapter converts to a BSON `_id` for the match.

### `mongoStats` capability (`src/shared/adapter/mongo-stats-types.ts`)

```ts
export interface MongoSnapshot {
  connections: { current: number; available: number; active: number }
  opcounters: { insert: number; query: number; update: number; delete: number; command: number }
  mem: { residentMb: number; virtualMb: number }
  network: { bytesIn: number; bytesOut: number }
  uptimeSec: number
  repl: { setName: string; primary: boolean; secondary: boolean } | null
}
export interface MongoStats {
  serverStatus(): Promise<MongoSnapshot>
}
```

Separate from the Postgres `serverStats` (`ServerSnapshot` is literally pg_stat columns and does not fit). `opcounters` are cumulative; the renderer derives per-second rates the same way the PG dashboard does.

### HostApi

Routed like every other capability — a `XSupported(id)` boolean + a throw-if-absent private getter:

```ts
documentQuerySupported(id): Promise<boolean>
findDocs(id, coll, filter, opts, pageSize): Promise<OpenDocsResult>
aggregateDocs(id, coll, pipeline, pageSize): Promise<OpenDocsResult>
fetchDocs(id, queryId): Promise<DocsPage>
closeDocs(id, queryId): Promise<void>

documentMutatorSupported(id): Promise<boolean>
insertDoc(id, coll, doc): Promise<{ insertedId: unknown }>
updateDoc(id, coll, docId, patch): Promise<{ matched: number }>
deleteDoc(id, coll, docId): Promise<{ deleted: number }>

mongoStatsSupported(id): Promise<boolean>
mongoServerStatus(id): Promise<MongoSnapshot>
```

The renderer RPC client is a dynamic `Proxy` — no method registry to update. `adapter-factory.ts` gets one new `case 'mongodb'`.

### Connection profile (`src/shared/adapter/types.ts`)

```ts
export interface MongoProfile {
  engine: 'mongodb'
  name: string
  // URI path (primary) — whole connection string incl. credentials.
  uri?: string
  // Discrete path (fallback) — used only when uri is absent.
  host?: string
  port?: number
  user?: string
  password?: string
  authSource?: string
  tls?: boolean
  // Default database (from URI path, or explicit).
  database?: string
}
```

`ConnectionProfile` becomes `PostgresProfile | SqliteProfile | MongoProfile`. `mongo-config.ts` reconciles: **`uri` present → use it verbatim; else assemble** `mongodb://[user:pass@]host:port/?authSource=…&tls=…`. Validation: exactly one of {`uri`, discrete host} is filled. Secrets stripped in `ProfileStore.save()`: **`uri`** (embeds the password) **and** `password` both routed through the keychain; the rest persists as plaintext JSON.

## Renderer

### Feature-detection routes the UI

`documentQuerySupported(connId)` marks a connection "document mode." The query tab, results panel, and tree-click behavior swap; relational connections are unchanged.

### Query tab (document mode)

A document query tab carries structured state instead of a `sql` string:

- **Collection** — set by clicking a collection in the tree (opens a doc-query tab bound to it) or a dropdown at the tab top.
- **Mode** — `[find | aggregate]` toggle.
- **Editor** — CodeMirror **JSON mode** (not SQL). `find` → filter object (`{ status: "open" }`); `aggregate` → pipeline array (`[ { $match: … } ]`). Relaxed JSON (unquoted keys, `$`-operators) parsed client-side; a parse-error banner blocks Run until valid — malformed input is never sent.
- **find extras** (collapsible): projection / sort / limit.
- **Run** → `findDocs`/`aggregateDocs`, streamed by cursor.

### Result rendering — documents, not a grid

- A scrollable **document list**; each document a card with two per-result view modes:
  - **Tree** (default) — `@uiw/react-json-view` collapsible tree.
  - **Raw** — read-only CodeMirror JSON, pretty-printed.
- Paging: cursor-backed "Load more" / infinite scroll, `pageSize ≈ 50`. Count + elapsed in the status bar; Cancel button closes the cursor.
- `DocumentResultSource` mirrors `QueryResultSource` but pages `Record<string,unknown>[]`.

### Document editing (gated on `documentMutatorSupported`)

- Each Tree card has **Edit** / **Delete**; the collection has a **＋ Insert document** action.
- **Edit** → editable raw JSON; on save, diff vs original → `updateDoc(coll, _id, {$set: changed})`; **preview the `$set` patch + confirm** before it runs. `_id` edits rejected.
- **Delete** → confirm showing `_id` → `deleteDoc`.
- **Insert** → blank JSON editor → `insertDoc`.
- After any mutation, refetch the current page.

### Schema tree

Database → collection maps onto the existing schema→table nodes: collections render as table leaves; **clicking a collection opens a doc-query tab** (not the relational data grid). Collection expansion shows sampled fields as "columns" from `getColumns` (filter hints). No Views/Functions/Triggers folders for Mongo (`objects` omitted).

### Mongo dashboard

A `MongoDashboard` (separate from the PG `ServerDashboard`), shown only when `mongoStatsSupported`: opcounter rate charts (reuse `TimeSeriesChart`), a connections gauge, mem readout, repl badge. Polled with interval + pause via the existing `ControlsBar`. No sessions/roles/settings (Mongo admin is a later milestone).

## Contract testing

A **document-engine variant** — `runDocumentAdapterContractTests(makeAdapter, profile, expected)` — not the relational suite (its bad-SQL / `getKeys` / SQL-cursor assertions don't apply to documents):

- **Nav core:** `listDatabases`, `listSchemas`, `listTables` (collections + `type`), `getColumns` (sampled fields present, `_id` among them), `getIndexes` (the `_id_` index).
- **`documentQuery`:** `find` with a filter returns matching docs; paging to the fixture doc count; `aggregate` (`$group`) returns grouped docs; cursor cancel/close.
- **`documentMutator`:** insert → find-back → `updateById` `$set` → verify → `deleteById` → verify gone.
- **`mongoStats`:** `serverStatus()` non-empty; `opcounters.query` present.

**Docker:** `pnpm db:up` adds a `mongo` service; `tests/contract/mongo-fixture.ts` seeds DB `app` with `users`(1000)/`orders`(5000) mirroring the relational fixture so assertions parallel. `tests/contract/mongodb.contract.test.ts` wires it. `pnpm test:contract` runs it alongside the PG/SQLite suites.

## Error handling

- Connect failures (bad URI/auth/SRV DNS) → the existing connection error surface.
- Query parse errors → client-side banner; never sent to the engine.
- Driver errors (bad `$op`, unknown pipeline stage) → the results error banner.
- `cancel` closes the active cursor; a killed db-host clears the connection as today.

## Security

- The connection URI/password are secrets: stripped from any renderer-bound profile, stored via the OS keychain (`safeStorage`), reconstituted only in main/db-host. Documents and queries cross the RPC boundary addressed by `connectionId`; no new secret surface.
- Mutations run on the user's authenticated connection under their DB privileges; edits are previewed + confirmed.

## Testing summary

- **Contract** (document variant, Docker MongoDB): nav core + all three capabilities, as above.
- **Unit:** the relaxed-JSON/EJSON parse+serialize helpers (pure), the `$set`-diff builder (pure), `mongo-config` URI reconciliation (pure).
- **e2e:** none — the Mongo path needs the OS keychain (`safeStorage`), unavailable headless, the same limitation the PG `query.spec` hits. Coverage is the document contract suite + the shared RPC contract. Documented deliberate gap.

## Exit criteria

v0.3.0 — connect to MongoDB (URI or fields); browse databases/collections in the tree; run find/aggregate and read results as JSON tree/raw; insert/edit/delete a document with preview+confirm; watch a Mongo server-status dashboard. All capability-gated; Postgres/SQLite unchanged.

## New dependencies

- `mongodb` (official driver, db-host).
- `@uiw/react-json-view` (renderer, JSON tree).

## Phasing (for the plan)

One spec; the plan runs three phases, each a run of per-task PRs against `main` with a phase review (MA-milestone discipline):

1. **Phase 1 — Browse.** MongoProfile + `mongo-config` (+ unit); `MongoAdapter` nav core; EJSON serialize/relaxed-JSON parse (+ unit); `documentQuery`; document-variant contract; Docker mongo + fixture; HostApi routing; connection form; JSON-mode query tab; document-list results (Tree/Raw); tree mapping. *Ships the read wedge (v0.3-preview).*
2. **Phase 2 — Edit.** `documentMutator` + contract; `$set`-diff builder (+ unit); card Edit/Delete + collection Insert with patch preview/confirm.
3. **Phase 3 — Stats.** `mongoStats` + contract; `MongoDashboard`.

## Task decomposition (for the plan)

**Phase 1:** (1) `MongoProfile` + `mongo-config` reconciliation + unit; (2) EJSON/relaxed-JSON helpers + unit; (3) `MongoAdapter` nav core + `documentQuery` + `document-types.ts` + factory case; (4) document-variant contract + Docker mongo service + `mongo-fixture.ts`; (5) HostApi `documentQuery*` routing + host-api contract; (6) connection form (URI + discrete) ; (7) document-mode query tab (collection + find/aggregate + JSON editor) + `DocumentResultSource`; (8) document-list results (Tree/Raw) + tree-click mapping.
**Phase 2:** (9) `documentMutator` + contract + `$set`-diff unit; (10) card Edit/Delete/Insert + preview/confirm.
**Phase 3:** (11) `mongoStats` + contract; (12) `MongoDashboard` + gating.

## Self-review

1. **Spec coverage:** profile (§profile, T1) · nav core + documentQuery (§nav, §documentQuery, T3) · results/editor/tree (§Renderer, T6–8, T10) · documentMutator (§documentMutator, T9–10) · mongoStats (§mongoStats, T11–12) · contract (§Contract, T4/T5/T9/T11) · EJSON/parse/diff units (§Testing, T2/T9). All covered.
2. **Placeholder scan:** none — capability interfaces, profile shape, HostApi signatures, and the mapping table are concrete.
3. **Consistency:** `documentQuery`/`documentMutator`/`mongoStats` names, `DocsPage.docs`, `OpenDocsResult.queryId`, `updateById`→`$set`, `_id`-as-unique-key used consistently across adapter, HostApi, renderer, and contract sections.
4. **Ambiguity:** profile precedence (URI wins), `getColumns` inference (first-seen type, hint-only), `executeQuery` on Mongo (throws), and `_id` immutability are each stated explicitly.

**Known deliberate deferrals:** Mongo server administration (currentOp/killOp, users), index create/drop UI, `$jsonSchema` validation editing, Mongo-views-as-objects, SQL→Mongo translation, PG-style e2e.

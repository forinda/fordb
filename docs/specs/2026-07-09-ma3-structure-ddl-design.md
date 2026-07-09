# MA3a — Structure Page + Additive DDL (Design)

**Status:** approved scope, ready for plan
**Date:** 2026-07-09
**Milestone:** MA3 (first slice; in-place column ALTER + SQLite table-rebuild deferred to MA3b)

## Goal

Inspect a table's full structure (columns / keys / indexes + reconstructed `CREATE TABLE` DDL) and perform **additive** schema changes — each **generated → previewed → applied** — from a dedicated Structure tab. Postgres full; SQLite for the ops its plain `ALTER`/`CREATE` supports without a table rebuild. The capability advertises what each engine can do so the UI only offers valid ops.

## Scope

### In (MA3a)

- **Structure view** (read): columns (name, type, nullable, default, ordinal), keys (pk / unique / fk), indexes, and a reconstructed `CREATE TABLE …` DDL string.
- **DDL ops** (each previewed then applied, in a transaction where the engine supports DDL-in-txn):
  - `CREATE TABLE` — columns with type, NOT NULL, DEFAULT, a single-/multi-column PK.
  - `ALTER TABLE ADD COLUMN`.
  - `CREATE INDEX` / `DROP INDEX` (unique optional).
  - `ADD FOREIGN KEY` / `DROP FOREIGN KEY` — **Postgres only** (SQLite needs a table rebuild → advertised unsupported).
  - `DROP TABLE`.
  - `CREATE SCHEMA` / `DROP SCHEMA` — **Postgres only** (SQLite has no CREATE SCHEMA; its "schemas" are attached DB files).
  - `CREATE DATABASE` / `DROP DATABASE` — **Postgres only** (SQLite DB = a file; out of scope).

### Out (deferred to MA3b)

- In-place column changes: rename, change type, change default, change nullable.
- `DROP COLUMN` (simple on modern SQLite, but grouped with the rebuild family for a coherent MA3b).
- SQLite 12-step table-rebuild machinery (drives every deferred op).
- FK / schema / database ops on SQLite.

## Architecture

Mirrors the established optional-capability pattern (`dataMutator`, `dataBrowser`).

### `SchemaEditor` capability (`src/shared/adapter/schema-types.ts`)

```ts
// What an engine can do — the UI reads this to show only valid actions.
export interface SchemaOps {
  createTable: boolean
  addColumn: boolean
  createIndex: boolean
  dropIndex: boolean
  addForeignKey: boolean
  dropForeignKey: boolean
  dropTable: boolean
  createSchema: boolean
  dropSchema: boolean
  createDatabase: boolean
  dropDatabase: boolean
}

export interface ColumnSpec {
  name: string
  type: string // raw engine type text, e.g. 'text', 'integer', 'timestamptz'
  notNull?: boolean
  default?: string | null // raw SQL expression (DDL literal), null = none
}
export interface TableSpec {
  schema: string
  table: string
  columns: ColumnSpec[]
  primaryKey?: string[] // column names; empty/absent → no PK
}
export interface IndexSpec {
  schema: string
  table: string
  name: string
  columns: string[]
  unique?: boolean
}
export interface ForeignKeySpec {
  schema: string
  table: string
  name: string
  columns: string[]
  refSchema: string
  refTable: string
  refColumns: string[]
}

// A single DDL change, discriminated by kind. The renderer builds one of these
// from a form, buildDdl() turns it into SQL, the user previews, applyDdl() runs it.
export type DdlChange =
  | { kind: 'createTable'; spec: TableSpec }
  | { kind: 'addColumn'; schema: string; table: string; column: ColumnSpec }
  | { kind: 'createIndex'; spec: IndexSpec }
  | { kind: 'dropIndex'; schema: string; name: string }
  | { kind: 'addForeignKey'; spec: ForeignKeySpec }
  | { kind: 'dropForeignKey'; schema: string; table: string; name: string }
  | { kind: 'dropTable'; schema: string; table: string }
  | { kind: 'createSchema'; name: string }
  | { kind: 'dropSchema'; name: string }
  | { kind: 'createDatabase'; name: string }
  | { kind: 'dropDatabase'; name: string }

export interface SchemaEditor {
  readonly ops: SchemaOps
  applyDdl(statements: string[]): Promise<void>
}
```

`DbAdapter` gains `readonly schemaEditor?: SchemaEditor`.

### Pure DDL generation (`src/shared/ddl/build-ddl.ts`)

`buildDdl(change: DdlChange, dialect: 'pg' | 'sqlite'): string[]` — pure, returns one or more statements. All identifiers quoted via the shared `quoteIdent` (`"`-doubling). **Column types and DEFAULT expressions are raw SQL text** the user typed — interpolated as-is. This is inherent to DDL (a type or default *is* a SQL fragment) and is why every DDL op is **previewed and confirmed** before apply; it is a privileged, authenticated, local-user action, not a bound-value path. Documented explicitly.

`reconstructDdl(cols, keys, indexes, schema, table, dialect): string` — pure, builds a `CREATE TABLE` + trailing `CREATE INDEX` lines from existing introspection (`getColumns`/`getKeys`/`getIndexes`), for the read-only DDL view.

### Engine adapters

- `PgSchemaEditor` (`src/db-host/postgres/postgres-schema.ts`): `ops` = all true. `applyDdl` runs the statements in a single transaction on a **dedicated `pg.Client`** (same pattern as `PgDataMutator` — avoids queuing behind an open browse/query cursor), `BEGIN … COMMIT`, rollback + rethrow on error. `CREATE DATABASE` / `DROP DATABASE` cannot run inside a transaction → when the statement list is a single database op, run it without `BEGIN`.
- `SqliteSchemaEditor` (`src/db-host/sqlite/sqlite-schema.ts`): `ops` = `{ createTable, addColumn, createIndex, dropIndex, dropTable: true, rest: false }`. `applyDdl` uses `client.batch(statements, 'write')` (transactional).

### HostApi surface (`src/shared/host/host-api.ts`)

```ts
schemaEditSupported(id: ConnectionId): Promise<boolean>
schemaOps(id: ConnectionId): Promise<SchemaOps>
applyDdl(id: ConnectionId, statements: string[]): Promise<void>
```

Routed in `host-api-impl.ts` exactly like the mutator/browser (throw if `schemaEditor` absent). DDL is **generated in the renderer** via the pure `buildDdl` (dialect from the active connection's engine), previewed, then only the final `statements[]` cross to the host for `applyDdl`. After a successful apply the renderer invalidates the introspection query cache for the connection (schema tree + structure view refresh).

### Renderer

- **New tab kind** `'structure'` on `QueryTab`: `structure?: { schema: string; table: string }`. Opened from the schema-tree table context menu ("Structure").
- **`StructureView`** (`src/renderer/src/components/StructureView.tsx`): reads `getColumns`/`getKeys`/`getIndexes` via the existing react-query introspection hooks (already cached, shared with the tree). Renders three panels + a reconstructed-DDL block. Each panel has additive actions gated on `schemaOps`:
  - Columns → `[+ column]` (name/type/nullable/default form).
  - Indexes → `[+ index]` (name/columns/unique) and per-index `[drop]`.
  - Foreign keys → `[+ FK]` (columns → ref table/columns) and per-FK `[drop]` (PG only).
  - Header → `[drop table]`.
- **Create-table** and **create/drop schema/database** launch from the schema-tree context menu on schema/database nodes (PG only), reusing the same form → preview → apply flow.
- **Preview + confirm:** every action builds a `DdlChange`, runs `buildDdl` → shows the generated SQL in a confirm dialog (reuse the row-edit preview convention: SQL shown, explicit confirm) → `applyDdl` → invalidate introspection → structure view + tree update.

## Data flow (add an index)

1. User clicks `[+ index]` in the Structure tab → small form (name, columns multiselect from the table's columns, unique checkbox).
2. Submit → `change: { kind: 'createIndex', spec }` → `buildDdl(change, dialect)` → `['CREATE UNIQUE INDEX "app"."idx" ON "app"."t" ("a", "b")']`.
3. Confirm dialog shows that SQL → user confirms.
4. `hostApi().applyDdl(connId, statements)` → `PgSchemaEditor.applyDdl` runs it in a txn.
5. On success: `invalidateIntrospection(queryClient, connId)` → the indexes panel and the tree re-fetch; the reconstructed DDL updates.

## Error handling

- `applyDdl` failure (bad type, duplicate name, FK violation) → txn rollback (PG) / batch abort (SQLite) → error surfaced in the Structure tab's error banner (same pattern as the data grid's apply error). No partial application.
- Engine-unsupported op is never offered (UI gated on `schemaOps`); `host-api-impl` still throws defensively if called.
- `CREATE/DROP DATABASE` outside a txn (PG) — handled by the single-statement bypass above.

## Security

- No secrets in the renderer (unchanged).
- DDL is privileged by nature; identifiers are quote-escaped; types/defaults are raw-by-design and mitigated by mandatory preview + confirm + local-only authenticated use. Every destructive op (`DROP …`) shows the SQL and requires explicit confirm (repo-wide rule, already enforced for row edits).

## Testing

- **Unit** (`tests/unit/build-ddl.test.ts`): `buildDdl` per op × dialect — quoting, NOT NULL/DEFAULT/PK rendering, unique index, FK clause, the single-statement database bypass shape; `reconstructDdl` round-trips a known structure.
- **Contract** (`tests/contract/adapter-contract.ts`, capability-gated on `schemaEditor`): for each supported op, apply generated DDL then assert via introspection the change took effect (create table → `listTables` sees it; add column → `getColumns`; create index → `getIndexes`; add FK (PG) → `getKeys`; drop reverses). Runs on a throwaway schema/table so it doesn't disturb the shared fixture.
- **host-api contract:** `schemaEditSupported` true, `schemaOps` shape, an `applyDdl` round-trip (create + drop a temp table).
- **e2e** (`tests/e2e/structure.spec.ts`, headless SQLite): open a table's Structure tab, add a column + an index (previewed), then drop the index — assert the DOM structure controls render and the introspection tree reflects the new column/index.

## Exit criteria

Create a table, add a column + an index + (PG) a FK, and drop them — all previewed then applied; a contract test per supported op; SQLite exercises its supported subset. Structure tab shows live columns/keys/indexes + reconstructed DDL.

## Task decomposition (for the plan)

1. `SchemaEditor` types + `DbAdapter.schemaEditor?`.
2. Pure `buildDdl` + `reconstructDdl` + unit tests.
3. `PgSchemaEditor` (txn apply, ops=all) + contract.
4. `SqliteSchemaEditor` (batch apply, limited ops) + contract.
5. HostApi `schemaEditSupported`/`schemaOps`/`applyDdl` routing + host-api contract.
6. Store: `'structure'` tab kind + `openStructure` + `applyDdl` action + introspection invalidation.
7. `StructureView`: panels + reconstructed DDL + add-column/index/FK + drop forms + preview/confirm.
8. Create-table + create/drop schema/database entries (schema-tree context menu, PG-gated).
9. e2e (headless SQLite).

**Deliberate deferrals (MA3b):** in-place column ALTER (rename/type/default/nullable), DROP COLUMN, SQLite table-rebuild, FK/schema/database ops on SQLite.

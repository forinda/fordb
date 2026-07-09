# MA3b — In-place Column ALTER + SQLite Table-Rebuild (Design)

**Status:** approved scope (full, incl. rebuild), ready for plan
**Date:** 2026-07-09
**Milestone:** MA3b (completes the MA3 structure surface began in MA3a)

## Goal

From the Structure tab, change existing columns — rename, change type, set/drop default, set/drop NOT NULL, drop column — and add/drop foreign keys on SQLite. Each generated → previewed → applied. Postgres uses native in-place `ALTER TABLE`; SQLite uses native `ALTER` where it can (rename column, drop column) and the official table-rebuild for what it can't (type/default/nullable changes, FK add/drop), preserving all rows, indexes, and foreign keys.

## Scope

### In (MA3b)

- **Rename column** — PG + SQLite native (`ALTER TABLE … RENAME COLUMN`).
- **Drop column** — PG + SQLite native (`ALTER TABLE … DROP COLUMN`, SQLite ≥ 3.35 / libsql).
- **Alter column** (any combination of type / default / nullable on one column):
  - PG: native `ALTER COLUMN … TYPE / SET|DROP DEFAULT / SET|DROP NOT NULL`.
  - SQLite: **table-rebuild** (SQLite can't alter a column in place).
- **Add / drop foreign key on SQLite** — via table-rebuild (was PG-only in MA3a).

### Out (future)

- Column reordering, computed/generated columns, check constraints, `USING` cast expressions on a PG type change (a plain `TYPE t` cast only; incompatible casts surface the engine error).
- Multi-table / cross-schema rebuilds; rebuild of a table other tables reference is handled by `defer_foreign_keys` but not otherwise specially coordinated.

## Architecture

Extends MA3a's `SchemaEditor` capability — **no new capability, no new HostApi method.** `applyDdl(statements)` already runs a statement list transactionally; MA3b only adds new `DdlChange` kinds, new `buildDdl` output (including the multi-statement rebuild), and the introspection needed to reconstruct a table.

### Introspection: referenced FK columns

Reconstructing a table during a rebuild needs each existing FK's **referenced columns**, which `KeyInfo` does not currently carry. Extend it:

```ts
export interface KeyInfo {
  name: string
  kind: 'primary' | 'foreign' | 'unique'
  columns: string[]
  referencedTable: string | null
  referencedColumns: string[] | null // NEW: FK target columns (null for pk/unique)
}
```

- SQLite: `PRAGMA foreign_key_list` already returns `to` (verified) → populate `referencedColumns`.
- Postgres: extend the key query (`information_schema` / `pg_constraint`) to return the referenced column list.
- Contract asserts `orders.user_id → users(id)` reports `referencedColumns: ['id']` on both engines.

### New DdlChange kinds (`schema-types.ts`)

```ts
  | { kind: 'renameColumn'; schema: string; table: string; from: string; to: string }
  | { kind: 'dropColumn'; schema: string; table: string; column: string }
  | {
      kind: 'alterColumn'
      schema: string
      table: string
      column: string
      // Each optional; absent = unchanged. default: string = SET DEFAULT expr,
      // null = DROP DEFAULT, undefined = unchanged.
      type?: string
      default?: string | null
      notNull?: boolean
    }
```

`addForeignKey` / `dropForeignKey` kinds are unchanged (MA3a) — only their SQLite implementation is new (rebuild).

### SchemaOps additions

```ts
renameColumn: boolean
dropColumn: boolean
alterColumn: boolean // type/default/nullable (native on PG, rebuild on SQLite)
```

- **Postgres:** all new flags `true`; `addForeignKey`/`dropForeignKey` stay `true` (native).
- **SQLite:** `renameColumn: true`, `dropColumn: true`, `alterColumn: true` (rebuild), and `addForeignKey`/`dropForeignKey` flip to `true` (rebuild). `createSchema`/`createDatabase`/`dropSchema`/`dropDatabase` stay `false`.

### Pure DDL generation

`buildDdl(change, dialect, context?)` gains an optional third argument:

```ts
export interface TableStructure {
  columns: ColumnInfo[]
  keys: KeyInfo[]
  indexes: IndexInfo[]
}
export function buildDdl(change: DdlChange, dialect: Dialect, context?: TableStructure): string[]
```

- PG + SQLite-native ops ignore `context`.
- SQLite rebuild ops (`alterColumn`, `addForeignKey`, `dropForeignKey`) **require** `context` (throw a clear error if absent) — the renderer passes the Structure tab's already-loaded `columns`/`keys`/`indexes`.

**Postgres in-place** (`buildDdl` → one or more statements, all applied in one txn):

- `renameColumn` → `ALTER TABLE s.t RENAME COLUMN "from" TO "to"`
- `dropColumn` → `ALTER TABLE s.t DROP COLUMN "c"`
- `alterColumn` → one statement per provided field:
  - `type` → `ALTER TABLE s.t ALTER COLUMN "c" TYPE <type>`
  - `default` = expr → `ALTER TABLE s.t ALTER COLUMN "c" SET DEFAULT <expr>`; `= null` → `… DROP DEFAULT`
  - `notNull` = true → `… SET NOT NULL`; `= false` → `… DROP NOT NULL`

**SQLite native:**

- `renameColumn` → `ALTER TABLE s.t RENAME COLUMN "from" TO "to"`
- `dropColumn` → `ALTER TABLE s.t DROP COLUMN "c"`

**SQLite rebuild** (`buildSqliteRebuild(context, mutate, schema, table)`): apply the change to the current structure to get the **new** column/pk/fk set, then emit the official sequence (verified working inside a `batch('write')` txn):

```
PRAGMA defer_foreign_keys=ON
CREATE TABLE "s"."t__fordb_rebuild" (<new col defs>, PRIMARY KEY(...), <fk constraints>)
INSERT INTO "s"."t__fordb_rebuild" (<carried cols>) SELECT <carried cols> FROM "s"."t"
DROP TABLE "s"."t"
ALTER TABLE "s"."t__fordb_rebuild" RENAME TO "t"
CREATE INDEX ... (each non-PK index from context, recreated)
```

- **Carried columns** = the columns present in BOTH old and new (all of them for type/default/nullable/FK changes; the rebuild path is never used for drop-column, which is native).
- **New column defs** come from `context.columns` with the `alterColumn` change applied (type/default/nullable swapped on the target column).
- **FK constraints** come from `context.keys` (existing FKs, using the new `referencedColumns`) plus/minus the add/drop-FK change.
- **Indexes** recreated from `context.indexes`, skipping the PK's implied backing index (same dedup rule as `reconstructDdl`).
- The temp name `<table>__fordb_rebuild` is fixed; a leftover from a crashed prior run would collide — the rebuild is the first thing in its own transaction, so a failure rolls back cleanly and leaves no temp table.

### Engine adapters

- `PgSchemaEditor`: `ops` gains the three new `true` flags. `applyDdl` unchanged (in-place ALTERs are ordinary statements in the existing txn).
- `SqliteSchemaEditor`: `ops` gains rename/drop-column/alterColumn `true` and flips FK flags `true`. `applyDdl` unchanged — the rebuild's `PRAGMA defer_foreign_keys=ON` is the first statement in the `batch('write')` list and takes effect for that transaction (verified).

### Renderer

`StructureView` (MA3a) gains per-column editing:

- Each column row gets **Rename / Alter / Drop** actions (gated on `schemaOps`).
  - Rename → prompt/inline for the new name → `renameColumn`.
  - Alter → inline form (new type, default expr or "drop default", nullable toggle) → `alterColumn` with only the changed fields.
  - Drop → `dropColumn` (previewed; destructive).
- The **+ FK / drop FK** actions (added in MA3a, PG-only) become available on SQLite too (now that `ops.addForeignKey`/`dropForeignKey` are true there).
- SQLite rebuild ops pass the tab's loaded `columns`/`keys`/`indexes` as `context` to `buildDdl`. The generated multi-statement rebuild is shown in the **preview** (so the user sees exactly what will run) then applied.

Everything else (preview+confirm, error banner, `applyDdl` → introspection invalidation) is unchanged from MA3a.

## Data flow (change a SQLite column type)

1. Structure tab, column `amt` → **Alter** → set type `NUMERIC` → submit.
2. `buildDdl({kind:'alterColumn', schema, table, column:'amt', type:'NUMERIC'}, 'sqlite', {columns,keys,indexes})` → the 6-statement rebuild sequence.
3. Confirm dialog shows the full sequence → user confirms.
4. `applyDdl(statements)` → `SqliteSchemaEditor.batch(statements,'write')` runs it atomically; `defer_foreign_keys` keeps FKs valid across the drop/rename.
5. Introspection invalidated → the column now reads `NUMERIC`; rows and FKs intact.

## Error handling

- Rebuild runs in one transaction; any failure rolls back — the original table is untouched, no `__fordb_rebuild` residue. Errors surface in the Structure tab / tree banner (MA3a).
- PG incompatible type cast (e.g. text→integer with non-numeric data) → the engine error surfaces; no partial change (single txn).
- Unsupported op never offered (UI gated on `schemaOps`); host throws defensively if bypassed.

## Security

Unchanged from MA3a: identifiers quote-escaped; types/defaults raw-by-design behind mandatory preview+confirm; every destructive op (drop column, rebuild that drops the old table) shows the generated SQL and requires confirm.

## Testing

- **Unit** (`build-ddl.test.ts`): PG rename/drop-column/alterColumn (each field + combinations); SQLite native rename/drop-column; SQLite rebuild — assert the full statement sequence for a type change (carried columns, FK preserved from context, index recreated), an add-FK, and a drop-FK; `buildDdl` throws when a rebuild op is called without `context`.
- **Contract** (capability-gated): PG — rename a column, change its type/default/nullable, drop a column, asserting introspection reflects each and reverses. SQLite — rename (native), drop-column (native), **type change via rebuild asserting row data is preserved**, add-FK via rebuild asserting `getKeys` shows it and data preserved. Uses a throwaway table.
- **KeyInfo.referencedColumns**: contract asserts the fixture FK reports its target column on both engines.
- **e2e** (`structure-alter.spec.ts`, headless SQLite): open a table's Structure tab, rename a column (native) and change a column's type (rebuild), asserting the new name/type appears and a known row value survives.

## Exit criteria

Rename, retype, re-default, toggle-nullable, and drop a column — on Postgres in place and on SQLite (native where possible, rebuild otherwise, data preserved) — plus add/drop a foreign key on SQLite; all previewed then applied; contract per op; e2e proves a SQLite rebuild preserves data.

## Task decomposition (for the plan)

1. `KeyInfo.referencedColumns` (types + PG/SQLite `getKeys` + contract) and new `SchemaOps` fields + `DdlChange` kinds + `TableStructure`.
2. `buildDdl` PG in-place alters (rename/drop-column/alterColumn) + unit tests.
3. `buildDdl` SQLite native + `buildSqliteRebuild` (rebuild) + unit tests (incl. context-required throw).
4. `PgSchemaEditor` ops + contract (PG in-place alters).
5. `SqliteSchemaEditor` ops + contract (native + rebuild, data-preservation).
6. `StructureView` per-column rename/alter/drop + SQLite FK add/drop, passing rebuild context.
7. e2e (SQLite rename + type-change rebuild, data preserved).

(HostApi unchanged — `applyDdl`/`schemaOps` already carry everything.)

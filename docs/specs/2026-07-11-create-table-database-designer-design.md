# Create Table Designer + Create Database Dialog — Design

**Status:** approved (modal dialogs; full DB metadata; Columns + Foreign Keys tabs; listRoles included), ready for plan
**Date:** 2026-07-11

## Goal

Replace the name-only "New table" / "New database" stubs with proper dialogs. A
tabbed **Create Table designer** (columns with type dropdowns, nullable, primary
key, unique, default, plus a Foreign Keys tab with schema-populated reference
dropdowns) and a **Create Database dialog** with full Postgres metadata. Both
emit DDL through the existing preview → confirm → apply path.

Exit: right-click a schema → "New table…" opens the tabbed designer; defining
columns + a foreign key produces one correct `CREATE TABLE` (both engines);
"New database…" (Postgres) opens the metadata dialog and creates the database.

## Current state

- "New table" (`SchemaTree.tsx:192-209`) opens the inline `NamePrompt`, takes
  only a name, and hardcodes `columns: [{ name: 'id', type: 'integer', notNull:
true }], primaryKey: ['id']`. Useless for a real table.
- "New database" / "New schema" (`SchemaTree.tsx:210-232`) also name-only.
- The DDL builder (`src/shared/ddl/build-ddl.ts`) **already** supports
  `createTable` (columns + PK), `addForeignKey`, `createIndex`, and
  `createDatabase` (name only). `HostApi` already exposes `listTables`,
  `getColumns`, `schemaOps`. So the gap is UI + a few pure DDL additions.
- `NamePrompt` is an inline bar, not a modal; there is **no** reusable modal
  primitive. `src/renderer/src/components/ui/` has input/button/select/label.

## Scope

### In

- Reusable `Modal` primitive (overlay, Esc + backdrop close, header + footer
  slots).
- **Create Table designer** modal: Columns tab + Foreign Keys tab; emits one
  `createTable` DdlChange.
- **Create Database dialog** modal: full Postgres metadata; emits `createDatabase`
  with options.
- DDL contract + builder additions: column `unique`, inline table FKs, database
  options.
- `HostApi.listRoles(id)` + Postgres implementation (owner dropdown).
- Wire both into `SchemaTree.tsx`, replacing the `NamePrompt` calls for table +
  database. ("New schema…" stays on `NamePrompt` — a schema is just a name.)

### Out (deferred / existing)

- Index designer at create time — full index management already lives in
  `StructureView.tsx` (post-create). Columns tab carries only a per-column
  `unique`.
- Table ALTER / structure editing — already in `StructureView.tsx`.
- Rich Create Database for SQLite/Mongo — SQLite `createDatabase` stays
  name-only via the existing path; Mongo has no tables (already hidden).
- Reordering persistence, templates/presets, check constraints.

## Architecture

```
src/renderer/src/components/ui/modal.tsx        NEW  reusable modal
src/renderer/src/components/CreateTableDialog.tsx   NEW  tabbed designer
src/renderer/src/components/CreateDatabaseDialog.tsx NEW  metadata form
src/renderer/src/components/SchemaTree.tsx      EDIT open dialogs instead of NamePrompt
src/shared/adapter/schema-types.ts             EDIT ColumnSpec.unique, TableSpec.foreignKeys, createDatabase options
src/shared/ddl/build-ddl.ts                     EDIT unique clause, inline FKs, db options
src/shared/ddl/pg-types.ts | sqlite-types.ts    NEW  curated type lists
src/shared/host/host-api.ts                     EDIT listRoles signature
src/db-host/postgres/*                          EDIT listRoles impl (SELECT rolname FROM pg_roles)
src/db-host/sqlite/* , main IPC                 EDIT listRoles stub (empty) for the contract
```

Data flow (unchanged spine): dialog collects state → on submit assembles a
`DdlChange` → `runDdl(change)` (`SchemaTree.tsx:104-113`) builds SQL via
`buildDdl`, shows the confirm, calls `useQueryStore.getState().applyDdl(stmts)`.
The dialogs only produce a `DdlChange`; they do not touch the apply path.

### Modal primitive

`ui/modal.tsx` — props `{ open, onClose, title, children, footer }`. Renders a
fixed overlay + centered panel; Escape and backdrop click call `onClose`;
`role="dialog"` + focus trap on the panel. Styling via existing tokens
(`bg-background`, `border-border`). No portal library — a fixed-position div is
enough.

### Create Table designer

State: `{ schema, table, columns: ColRow[], fks: FkRow[] }`.
`ColRow = { name, type, nullable, pk, unique, default }`.
`FkRow = { name, columns: string[], refSchema, refTable, refColumns: string[] }`.

- **Columns tab** — one row per column; add / remove / move up-down. `type` is a
  combobox: a curated per-dialect list (see type lists) with free-text entry for
  anything custom (`varchar(255)`, `numeric(10,2)`). Checkboxes: nullable, PK,
  unique. Composite PK = multiple `pk` checked.
- **Foreign Keys tab** — one row per FK. `refSchema` ← `listSchemas` (already
  loaded in the tree), `refTable` ← `api.listTables(id, refSchema)`, `refColumns`
  ← `api.getColumns(id, refSchema, refTable)`. Local `columns` is a multi-select
  of the columns defined in the Columns tab. FK `name` auto-defaults to
  `fk_<table>_<col>` and is editable.
- **Footer** — live SQL preview (calls `buildDdl` on the assembled spec) +
  Create / Cancel. Create is disabled until table name + ≥1 column with a name
  and type.

Emits a single `createTable` DdlChange whose `TableSpec` carries `columns`
(with `unique`), `primaryKey` (collected from `pk` flags), and `foreignKeys`
(inline). One `CREATE TABLE` statement — required for SQLite (no post-hoc named
FK) and clean for Postgres.

### Create Database dialog (Postgres)

State: `{ name, owner, encoding, template, lcCollate, lcCtype, tablespace,
connLimit }`. `owner` ← `api.listRoles(id)` dropdown; `encoding` default `UTF8`;
`template` dropdown `template1` / `template0`. All except `name` optional; blank
fields are omitted from the DDL. Emits `createDatabase` with an `options` object.
Gated by `ops.createDatabase` (Postgres). SQLite keeps the existing name-only
`NamePrompt` path.

## DDL contract + builder additions (pure, TDD)

`schema-types.ts`:

```ts
interface ColumnSpec {
  name: string
  type: string
  notNull?: boolean
  default?: string | null
  unique?: boolean
}
interface InlineForeignKey {
  name: string
  columns: string[]
  refSchema?: string
  refTable: string
  refColumns: string[]
}
interface TableSpec {
  schema: string
  table: string
  columns: ColumnSpec[]
  primaryKey?: string[]
  foreignKeys?: InlineForeignKey[]
}
interface CreateDatabaseOptions {
  owner?: string
  encoding?: string
  template?: string
  lcCollate?: string
  lcCtype?: string
  tablespace?: string
  connectionLimit?: number
}
// DdlChange createDatabase gains: { kind: 'createDatabase'; name: string; options?: CreateDatabaseOptions }
```

`build-ddl.ts`:

- `columnClause`: append ` UNIQUE` when `c.unique`.
- `createTable`: after the PK line, emit one
  `CONSTRAINT <name> FOREIGN KEY (cols) REFERENCES <refTable>(refCols)` line per
  `foreignKeys` entry. Ref table qualified with `refSchema` when present, bare
  otherwise (SQLite has no cross-schema FK in a table body).
- `createDatabase`: append the option clauses in a fixed order — `OWNER`,
  `ENCODING '<e>'`, `TEMPLATE`, `LC_COLLATE '<c>'`, `LC_CTYPE '<c>'`,
  `TABLESPACE`, `CONNECTION LIMIT <n>` — each only when its field is set.
  Identifiers quoted via `quoteIdent`; string literals single-quoted.

`host-api.ts`: `listRoles(id: ConnectionId): Promise<string[]>`.
Postgres impl: `SELECT rolname FROM pg_roles ORDER BY rolname`. SQLite impl:
returns `[]` (no roles) so the contract holds; the owner dropdown only shows in
the Postgres dialog anyway.

## Error handling

- Create disabled until required fields present (name + ≥1 named/typed column).
- Duplicate column names / empty FK ref flagged inline; Create stays disabled.
- The generated SQL still passes through the existing confirm gate before apply;
  a rejected statement surfaces via the existing `applyDdl` error path (no new
  handling).

## Testing

- **DDL builder (primary gate, TDD):** unit tests in `build-ddl` for the
  `UNIQUE` column clause, inline foreign keys in `CREATE TABLE` (single + multi,
  qualified + bare ref), and `CREATE DATABASE` option rendering (each option,
  all-set, none-set), per dialect where relevant.
- **listRoles:** contract-level — Postgres returns role names; SQLite returns
  `[]`. Covered by the adapter contract suite if `listRoles` is added to it,
  else a focused Postgres test.
- **Components:** light smoke (renders, Create disabled until valid, emits the
  expected DdlChange). No heavy E2E — the apply path is unchanged and already
  tested.

## Risks

- **SQLite inline FK ref schema** — SQLite FK in a table body cannot cross
  schemas; the builder emits a bare ref table for SQLite. The designer restricts
  the ref-schema dropdown to the table's own schema on SQLite.
- **Type list drift** — curated lists are a convenience, not validation; the
  free-text combobox is the escape hatch, so an incomplete list never blocks a
  user.
- **listRoles on locked-down Postgres** — `pg_roles` is readable by default; if
  denied, `listRoles` returns `[]` and owner falls back to a free-text entry.

## Exit criteria

Right-click schema → "New table…" opens the tabbed modal; defining columns
(type via dropdown, nullable/PK/unique) + a foreign key with schema-populated
reference dropdowns produces one correct `CREATE TABLE` on both Postgres and
SQLite. "New database…" on Postgres opens the metadata dialog (owner from
`listRoles`, encoding/template/etc.) and creates the database. DDL-builder unit
tests green.

## Task decomposition (for the plan)

1. **DDL contract + builder** — `ColumnSpec.unique`, `TableSpec.foreignKeys`,
   `createDatabase` options; `build-ddl` unique/inline-FK/db-options; unit tests.
2. **listRoles** — HostApi signature + Postgres impl + SQLite stub + IPC wiring.
3. **Modal primitive** — `ui/modal.tsx`.
4. **Create Table designer** — `CreateTableDialog.tsx` (Columns + FK tabs, type
   lists, live preview) + wire into `SchemaTree.tsx`.
5. **Create Database dialog** — `CreateDatabaseDialog.tsx` (metadata form) + wire
   into `SchemaTree.tsx`.

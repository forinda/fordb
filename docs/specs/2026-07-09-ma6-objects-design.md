# MA6 — Objects: Views / Routines / Triggers (Design)

**Status:** approved scope (objects read + view CRUD), ready for plan
**Date:** 2026-07-09
**Milestone:** MA6 (first slice; PG sequences/types and function/trigger editing → MA6b)

## Goal

Browse database objects by category (views, functions/procedures, triggers) in the schema tree, view each object's reconstructed definition, and create / replace / drop views. Engine-gated: Postgres exposes all three kinds; SQLite exposes views + triggers (it has no stored user functions).

## Scope

### In (MA6)

- **Object browsing:** the schema tree gains category folders under each schema — **Tables**, **Views**, **Functions** (PG only), **Triggers** — each lazily listing its objects. Only the categories an engine supports are shown.
- **Definitions:** clicking a view/function/trigger opens a read-only **definition tab** showing its DDL (PG `pg_get_viewdef`/`pg_get_functiondef`/`pg_get_triggerdef`; SQLite `sqlite_master.sql`).
- **View CRUD:** create / `CREATE OR REPLACE` / drop a **view** (previewed → applied via the existing transactional `applyDdl`).

### Out (MA6b / later)

- PG sequences and types (browse/definition).
- Creating/editing functions, procedures, triggers (definition view is read-only for these in MA6).
- Materialized views, view column-rename, dependency graph.

## Architecture

New optional capability mirroring `dataBrowser`/`schemaEditor`. Introspection only — no writes (view CRUD reuses `SchemaEditor`).

### `ObjectBrowser` capability (`src/shared/adapter/object-types.ts`)

```ts
export type ObjectKind = 'view' | 'function' | 'trigger'
export interface ObjectSummary {
  name: string
}
export interface ObjectBrowser {
  /** Which object kinds this engine exposes (drives the tree categories). */
  readonly kinds: readonly ObjectKind[]
  list(schema: string, kind: ObjectKind): Promise<ObjectSummary[]>
  /** Reconstructed DDL / stored definition for one object. */
  definition(schema: string, kind: ObjectKind, name: string): Promise<string>
}
```

`DbAdapter` gains `readonly objects?: ObjectBrowser`.

- **Postgres** (`kinds: ['view','function','trigger']`): list from `pg_views`/`pg_proc`/`pg_trigger` (schema-scoped, non-internal); definition from `pg_get_viewdef(oid, true)` / `pg_get_functiondef(oid)` / `pg_get_triggerdef(oid, true)`. Identifiers bound as parameters; the reg* lookups resolve name→oid safely.
- **SQLite** (`kinds: ['view','trigger']`): list + definition from `sqlite_master` (`type IN ('view','trigger')`, `sql` column) in the given schema.

### View CRUD via `SchemaEditor`

Extend `DdlChange` + `SchemaOps`:

```ts
  | { kind: 'createView'; schema: string; name: string; select: string; orReplace?: boolean }
  | { kind: 'dropView'; schema: string; name: string }
```

`SchemaOps` gains `createView: boolean`, `dropView: boolean` (both engines true — `CREATE VIEW`/`DROP VIEW` are standard). `buildDdl`:

- pg createView: `CREATE [OR REPLACE] VIEW "s"."v" AS <select>`
- sqlite createView: `CREATE VIEW "s"."v" AS <select>` (SQLite has no OR REPLACE — drop+create, or advertise no-replace; MA6 uses plain CREATE and the UI drops first if replacing)
- dropView (both): `DROP VIEW "s"."v"` (sqlite: bare-qualified per the existing sqlite-unqualify rule → `"s"."v"` is accepted for DROP VIEW; verified like DROP TABLE)

The `select` body is raw user SQL (preview-gated, same rationale as other DDL).

### HostApi

```ts
objectsSupported(id): Promise<boolean>
objectKinds(id): Promise<ObjectKind[]>
listObjects(id, schema, kind): Promise<ObjectSummary[]>
objectDefinition(id, schema, kind, name): Promise<string>
```

Routed like the other capabilities (throw if absent). View CRUD flows through the existing `applyDdl`.

### Renderer

- **Schema tree** (`schema-tree-model.ts` + `SchemaTree.tsx`): a schema now expands to **category folder** nodes (Tables / Views / Functions / Triggers, filtered by `objectKinds`). Tables folder → table nodes (with column children, as today). Each object-category folder → object nodes; clicking a view/function/trigger opens its definition tab; a table opens its data tab (unchanged). The existing lazy-load + cache-subscription machinery extends to category and object nodes.
- **Definition tab:** a new `'object'` tab kind carrying `{ schema, kind, name }`; `ObjectDefinitionView` fetches `objectDefinition` and renders it read-only in a monospace block (mirrors `ExplainView`).
- **View CRUD:** the **Views** category folder's context menu → **New view…** (inline name + a SELECT body input) → `createView`; an object node's menu → **Drop** (views) → `dropView`. Both previewed via the confirm + applied through `applyDdl`; introspection invalidated.

## Data flow (create a view, view its definition)

1. Right-click the **Views** folder → **New view…** → enter name + `SELECT id, email FROM users` → confirm generated `CREATE VIEW …` → applied.
2. The Views folder refreshes; click the new view → definition tab shows `CREATE VIEW … AS SELECT …`.

## Error handling

- List/definition failures surface in the tree (the object node shows an error) or the definition tab's banner.
- Create/drop failures roll back (single-statement `applyDdl` transaction) → the tree/DDL error banner (existing).
- An engine without `objects` simply shows no category folders beyond Tables (capability-gated).

## Security

- Introspection is read-only, schema/name bound as parameters (no interpolation in the lookup queries). Identifiers in generated view DDL quote-escaped; the SELECT body is user SQL, preview-gated. Secrets unaffected.

## Testing

- **Unit:** `buildDdl` createView (+ orReplace) / dropView per dialect.
- **Contract** (capability-gated): `objects.kinds` per engine; `list('app','view')` includes the fixture view `user_emails`; `definition(...,'view','user_emails')` contains `SELECT`; create a temp view via `applyDdl` → it appears in `list` → its `definition` is non-empty → drop it. Triggers: assert `list('...','trigger')` runs (fixture may have none → empty array, no throw).
- **e2e** (headless SQLite): expand a schema → Views folder → the fixture view shows; open its definition (assert `CREATE VIEW`/`SELECT` text); create a view via New view…, confirm it appears, drop it.

## Exit criteria

List and view the definitions of views/functions/triggers; create and drop a view — from the schema tree, previewed and applied.

## Task decomposition (for the plan)

1. `ObjectBrowser` types + `DbAdapter.objects?`; `DdlChange` createView/dropView + `SchemaOps` fields.
2. Object introspection (PG + SQLite adapters) + `buildDdl` view ops + unit tests + `SchemaEditor` ops.
3. Contract: object list/definition + view create/drop (both engines).
4. HostApi objectsSupported/objectKinds/listObjects/objectDefinition + routing + host-api contract.
5. Store: `'object'` tab kind + `openObjectDefinition` + `createView`/`dropView`; tree model category/object nodes.
6. SchemaTree: category folders + object nodes + definition/drop menu + New view…; `ObjectDefinitionView`.
7. e2e (SQLite): view definition + create/drop view.

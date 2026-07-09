# fordb MA3b — In-place Column ALTER + SQLite Table-Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the Structure tab, rename / retype / re-default / toggle-nullable / drop a column and add/drop FKs on SQLite — Postgres in place, SQLite native where possible and table-rebuild otherwise (preserving rows, indexes, FKs). Each generated → previewed → applied.

**Architecture:** Extends MA3a's `SchemaEditor` — no new capability or HostApi method. Adds `DdlChange` kinds, `SchemaOps` flags, `KeyInfo.referencedColumns`, and `buildDdl` output (including a pure `buildSqliteRebuild`). Verified: the SQLite 12-step rebuild runs atomically inside libsql `batch('write')` with `PRAGMA defer_foreign_keys=ON` as the first statement.

**Tech Stack:** TypeScript strict, `pg`, `@libsql/client`, React 19, Zustand, TanStack Query, vitest, Playwright.

## Global Constraints

- pnpm; Node >= 22; TypeScript strict; no `any` except typed RPC/DB-boundary casts.
- Identifiers quote-escaped via `quoteIdent`. Types/DEFAULT raw-by-design behind mandatory preview+confirm.
- Every op (esp. drop-column and any rebuild that drops the old table) shows generated SQL + explicit confirm.
- Capability-gated on `SchemaOps`; UI offers only supported ops; host throws defensively.
- SQLite rebuild ops (`alterColumn`, `addForeignKey`, `dropForeignKey`) REQUIRE a `TableStructure` context; `buildDdl` throws if it is missing.
- Apply is transactional (PG existing txn; SQLite `batch('write')`). Rebuild is atomic; failure leaves no `__fordb_rebuild` residue.
- After apply, invalidate the connection's introspection cache.
- `@shared/*` alias. Renderer-importing tests → `tsconfig.web`; pure/db-host → `tsconfig.node`.
- Each task ends `pnpm typecheck && pnpm lint && pnpm test` (+ `pnpm build` for renderer). Contract tasks run `pnpm db:up && pnpm test:contract && pnpm db:down`. One PR per task against `main`.

## File Structure (end state)

```
src/shared/adapter/types.ts                   # MODIFY: KeyInfo.referencedColumns
src/shared/adapter/schema-types.ts            # MODIFY: SchemaOps fields + DdlChange kinds + TableStructure
src/db-host/postgres/introspection-sql.ts     # MODIFY: GET_KEYS returns referencedColumns
src/db-host/postgres/postgres-adapter.ts      # MODIFY: map referencedColumns
src/db-host/sqlite/sqlite-adapter.ts          # MODIFY: populate referencedColumns from foreign_key_list
src/shared/ddl/build-ddl.ts                   # MODIFY: rename/dropColumn/alterColumn + buildSqliteRebuild
src/db-host/postgres/postgres-schema.ts       # MODIFY: PG_OPS new flags
src/db-host/sqlite/sqlite-schema.ts           # MODIFY: SQLITE_OPS new flags
src/renderer/src/components/StructureView.tsx # MODIFY: per-column rename/alter/drop + SQLite FK
tests/unit/build-ddl.test.ts                  # MODIFY
tests/contract/adapter-contract.ts            # MODIFY: referencedColumns + column-alter block
tests/e2e/structure-alter.spec.ts             # NEW
```

---

### Task 1: KeyInfo.referencedColumns + SchemaOps/DdlChange/TableStructure

**Files:**

- Modify: `src/shared/adapter/types.ts`, `src/shared/adapter/schema-types.ts`, `src/db-host/postgres/introspection-sql.ts`, `src/db-host/postgres/postgres-adapter.ts`, `src/db-host/sqlite/sqlite-adapter.ts`, `tests/contract/adapter-contract.ts`

**Interfaces:**

- Produces: `KeyInfo.referencedColumns: string[] | null`; `SchemaOps.{renameColumn,dropColumn,alterColumn}`; `DdlChange` kinds `renameColumn`/`dropColumn`/`alterColumn`; `TableStructure`.

- [ ] **Step 1: Types**

`src/shared/adapter/types.ts` — add to `KeyInfo`:

```ts
  referencedColumns: string[] | null // FK target columns (null for pk/unique)
```

`src/shared/adapter/schema-types.ts` — add to `SchemaOps`:

```ts
renameColumn: boolean
dropColumn: boolean
alterColumn: boolean
```

Add to the `DdlChange` union:

```ts
  | { kind: 'renameColumn'; schema: string; table: string; from: string; to: string }
  | { kind: 'dropColumn'; schema: string; table: string; column: string }
  | {
      kind: 'alterColumn'
      schema: string
      table: string
      column: string
      type?: string
      default?: string | null // expr = SET DEFAULT, null = DROP DEFAULT, undefined = unchanged
      notNull?: boolean
    }
```

Add `TableStructure` (imports `ColumnInfo`/`KeyInfo`/`IndexInfo` from `./types`):

```ts
import type { ColumnInfo, IndexInfo, KeyInfo } from './types'

export interface TableStructure {
  columns: ColumnInfo[]
  keys: KeyInfo[]
  indexes: IndexInfo[]
}
```

- [ ] **Step 2: Postgres getKeys returns referencedColumns**

`src/db-host/postgres/introspection-sql.ts` — in `GET_KEYS`, add after the `columns` array and `referencedTable`:

```ts
         confrel.relname AS "referencedTable",
         ARRAY(
           SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
           ORDER BY k.ord
         ) AS "referencedColumns"
```

(Replace the existing `confrel.relname AS "referencedTable"` line with the two above — mind the trailing comma.)

`src/db-host/postgres/postgres-adapter.ts` — in `getKeys`, map the new field (empty array → null for non-FK rows):

```ts
referencedColumns: Array.isArray(r.referencedColumns) && r.referencedColumns.length
  ? (r.referencedColumns as string[])
  : null
```

- [ ] **Step 3: SQLite getKeys populates referencedColumns**

`src/db-host/sqlite/sqlite-adapter.ts` — the FK branch of `getKeys` builds each foreign key from `foreignKeyList`. Extend the accumulator to also collect the `to` column, and set `referencedColumns` on the pushed key. Also set `referencedColumns: null` on the primary and unique keys pushed in the same method.

```ts
const byId = new Map<number, { columns: string[]; refCols: string[]; ref: string }>()
for (const r of await this.rows(SQL.foreignKeyList(schema, table))) {
  const id = Number(r.id)
  const e = byId.get(id) ?? { columns: [], refCols: [], ref: String(r.table) }
  e.columns.push(String(r.from))
  e.refCols.push(String(r.to))
  byId.set(id, e)
}
for (const [id, e] of byId)
  keys.push({
    name: `fk_${id}`,
    kind: 'foreign',
    columns: e.columns,
    referencedTable: e.ref,
    referencedColumns: e.refCols
  })
```

Add `referencedColumns: null` to the primary-key push and the unique-key push in the same method.

- [ ] **Step 4: Contract asserts referencedColumns**

In `tests/contract/adapter-contract.ts`, in the existing "reports primary, foreign, and unique keys" test, after the FK assertions add:

```ts
expect(fk?.referencedColumns).toEqual(['id'])
```

- [ ] **Step 5: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm db:up && pnpm test:contract && pnpm db:down`.

```bash
git add src/shared/adapter/types.ts src/shared/adapter/schema-types.ts src/db-host/postgres/introspection-sql.ts src/db-host/postgres/postgres-adapter.ts src/db-host/sqlite/sqlite-adapter.ts tests/contract/adapter-contract.ts
git commit -m "feat: KeyInfo.referencedColumns + MA3b DdlChange/SchemaOps/TableStructure types"
```

---

### Task 2: buildDdl — Postgres in-place column alters

**Files:**

- Modify: `src/shared/ddl/build-ddl.ts`, `tests/unit/build-ddl.test.ts`

**Interfaces:**

- Consumes: `DdlChange` kinds from Task 1.
- Produces: `buildDdl` handles `renameColumn`/`dropColumn`/`alterColumn` for `dialect: 'pg'`.

- [ ] **Step 1: Failing tests**

`tests/unit/build-ddl.test.ts` — add:

```ts
it('pg renameColumn / dropColumn', () => {
  expect(
    buildDdl({ kind: 'renameColumn', schema: 'app', table: 't', from: 'a', to: 'b' }, 'pg')
  ).toEqual([`ALTER TABLE "app"."t" RENAME COLUMN "a" TO "b"`])
  expect(buildDdl({ kind: 'dropColumn', schema: 'app', table: 't', column: 'a' }, 'pg')).toEqual([
    `ALTER TABLE "app"."t" DROP COLUMN "a"`
  ])
})
it('pg alterColumn: one statement per changed field, in a stable order', () => {
  expect(
    buildDdl(
      {
        kind: 'alterColumn',
        schema: 'app',
        table: 't',
        column: 'a',
        type: 'text',
        default: `'x'`,
        notNull: true
      },
      'pg'
    )
  ).toEqual([
    `ALTER TABLE "app"."t" ALTER COLUMN "a" TYPE text`,
    `ALTER TABLE "app"."t" ALTER COLUMN "a" SET DEFAULT 'x'`,
    `ALTER TABLE "app"."t" ALTER COLUMN "a" SET NOT NULL`
  ])
})
it('pg alterColumn: DROP DEFAULT / DROP NOT NULL', () => {
  expect(
    buildDdl(
      {
        kind: 'alterColumn',
        schema: 'app',
        table: 't',
        column: 'a',
        default: null,
        notNull: false
      },
      'pg'
    )
  ).toEqual([
    `ALTER TABLE "app"."t" ALTER COLUMN "a" DROP DEFAULT`,
    `ALTER TABLE "app"."t" ALTER COLUMN "a" DROP NOT NULL`
  ])
})
```

- [ ] **Step 2: Run → FAIL** — `pnpm vitest run tests/unit/build-ddl.test.ts`.

- [ ] **Step 3: Implement**

In `src/shared/ddl/build-ddl.ts`, add a PG-only column-alter helper and wire the three new kinds. `alterColumn` on PG builds statements in the fixed order type → default → notNull:

```ts
function pgAlterColumn(change: Extract<DdlChange, { kind: 'alterColumn' }>): string[] {
  const t = qtable(change.schema, change.table)
  const col = qi(change.column)
  const out: string[] = []
  if (change.type !== undefined)
    out.push(`ALTER TABLE ${t} ALTER COLUMN ${col} TYPE ${change.type}`)
  if (change.default !== undefined)
    out.push(
      change.default === null
        ? `ALTER TABLE ${t} ALTER COLUMN ${col} DROP DEFAULT`
        : `ALTER TABLE ${t} ALTER COLUMN ${col} SET DEFAULT ${change.default}`
    )
  if (change.notNull !== undefined)
    out.push(
      change.notNull
        ? `ALTER TABLE ${t} ALTER COLUMN ${col} SET NOT NULL`
        : `ALTER TABLE ${t} ALTER COLUMN ${col} DROP NOT NULL`
    )
  return out
}
```

Add cases to the `buildDdl` switch (the SQLite branches come in Task 3; for now, PG handles all three and SQLite `renameColumn`/`dropColumn` share the PG statement — they are identical native ALTERs — while `alterColumn` on SQLite is added in Task 3):

```ts
    case 'renameColumn':
      return [
        `ALTER TABLE ${qtable(change.schema, change.table)} RENAME COLUMN ${qi(change.from)} TO ${qi(change.to)}`
      ]
    case 'dropColumn':
      return [`ALTER TABLE ${qtable(change.schema, change.table)} DROP COLUMN ${qi(change.column)}`]
    case 'alterColumn':
      if (dialect === 'pg') return pgAlterColumn(change)
      // SQLite alterColumn → rebuild (Task 3).
      throw new Error('SQLite alterColumn requires the rebuild path (Task 3)')
```

- [ ] **Step 4: Run → PASS + commit**

Run: `pnpm vitest run tests/unit/build-ddl.test.ts`, then `pnpm typecheck && pnpm lint`.

```bash
git add src/shared/ddl/build-ddl.ts tests/unit/build-ddl.test.ts
git commit -m "feat: buildDdl Postgres in-place column alters (rename/drop/alter)"
```

---

### Task 3: buildDdl — SQLite native + table-rebuild

**Files:**

- Modify: `src/shared/ddl/build-ddl.ts`, `tests/unit/build-ddl.test.ts`

**Interfaces:**

- Consumes: `TableStructure`, `ColumnInfo`, `KeyInfo`, `IndexInfo`.
- Produces: `buildDdl(change, 'sqlite', context)` for `alterColumn`/`addForeignKey`/`dropForeignKey` via `buildSqliteRebuild`; throws without `context`.

- [ ] **Step 1: Failing tests**

`tests/unit/build-ddl.test.ts` — add. The rebuild sequence is asserted structurally (statement count + key fragments) to stay robust to whitespace:

```ts
const struct = {
  columns: [
    { name: 'id', dataType: 'INTEGER', nullable: false, defaultValue: null, ordinal: 1 },
    { name: 'user_id', dataType: 'INTEGER', nullable: true, defaultValue: null, ordinal: 2 },
    { name: 'amt', dataType: 'REAL', nullable: true, defaultValue: null, ordinal: 3 }
  ],
  keys: [
    {
      name: 'primary',
      kind: 'primary' as const,
      columns: ['id'],
      referencedTable: null,
      referencedColumns: null
    },
    {
      name: 'fk_0',
      kind: 'foreign' as const,
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id']
    }
  ],
  indexes: [{ name: 'orders_uid', columns: ['user_id'], unique: false }]
}
it('sqlite alterColumn rebuild: preserves columns, FK, index; changes the type', () => {
  const stmts = buildDdl(
    { kind: 'alterColumn', schema: 'main', table: 'orders', column: 'amt', type: 'NUMERIC' },
    'sqlite',
    struct
  )
  expect(stmts[0]).toBe('PRAGMA defer_foreign_keys=ON')
  const create = stmts.find((s) => s.startsWith('CREATE TABLE'))!
  expect(create).toContain('"amt" NUMERIC')
  expect(create).toContain('FOREIGN KEY ("user_id") REFERENCES "users" ("id")')
  expect(
    stmts.some((s) => s.startsWith('INSERT INTO') && s.includes('"id", "user_id", "amt"'))
  ).toBe(true)
  expect(stmts).toContain('DROP TABLE "main"."orders"')
  expect(stmts.some((s) => s.includes('RENAME TO "orders"'))).toBe(true)
  expect(stmts.some((s) => s.startsWith('CREATE INDEX') && s.includes('"orders_uid"'))).toBe(true)
})
it('sqlite addForeignKey rebuild adds the constraint', () => {
  const stmts = buildDdl(
    {
      kind: 'addForeignKey',
      spec: {
        schema: 'main',
        table: 'orders',
        name: 'fk_new',
        columns: ['user_id'],
        refSchema: 'main',
        refTable: 'users',
        refColumns: ['id']
      }
    },
    'sqlite',
    struct
  )
  expect(stmts.find((s) => s.startsWith('CREATE TABLE'))).toContain(
    'FOREIGN KEY ("user_id") REFERENCES "users" ("id")'
  )
})
it('sqlite rebuild op without context throws', () => {
  expect(() =>
    buildDdl(
      { kind: 'alterColumn', schema: 'main', table: 'orders', column: 'amt', type: 'NUMERIC' },
      'sqlite'
    )
  ).toThrow(/context/i)
})
```

- [ ] **Step 2: Run → FAIL**.

- [ ] **Step 3: Implement**

In `src/shared/ddl/build-ddl.ts`. `alterColumn`/`addForeignKey`/`dropForeignKey` on SQLite route to `buildSqliteRebuild`. Note `addForeignKey`/`dropForeignKey` currently return their PG ALTER form for BOTH dialects — change them to branch: PG keeps the ALTER, SQLite goes to rebuild.

```ts
interface Fk {
  name: string
  columns: string[]
  refTable: string
  refColumns: string[]
}

// Apply a change to the current structure and emit the SQLite 12-step rebuild.
// Verified atomic inside batch('write') with defer_foreign_keys first.
function buildSqliteRebuild(
  ctx: TableStructure,
  schema: string,
  table: string,
  mutate: { columns: ColumnSpec[]; fks: Fk[] }
): string[] {
  const tmp = `${table}__fordb_rebuild`
  const colDefs = mutate.columns.map(columnClause)
  const pk = ctx.keys.find((k) => k.kind === 'primary')
  if (pk && pk.columns.length) colDefs.push(`PRIMARY KEY (${pk.columns.map(qi).join(', ')})`)
  for (const fk of mutate.fks)
    colDefs.push(
      `FOREIGN KEY (${fk.columns.map(qi).join(', ')}) REFERENCES ${qi(fk.refTable)} (${fk.refColumns.map(qi).join(', ')})`
    )
  // Carried columns = new columns that also exist in the old table.
  const oldNames = new Set(ctx.columns.map((c) => c.name))
  const carried = mutate.columns.filter((c) => oldNames.has(c.name)).map((c) => qi(c.name))
  const idxLines = ctx.indexes
    .filter((i) => !(pk && i.columns.join(',') === pk.columns.join(',') && i.unique))
    .map((i) =>
      createIndex({ schema, table, name: i.name, columns: i.columns, unique: i.unique }, 'sqlite')
    )
  return [
    `PRAGMA defer_foreign_keys=ON`,
    `CREATE TABLE ${qtable(schema, tmp)} (\n  ${colDefs.join(',\n  ')}\n)`,
    `INSERT INTO ${qtable(schema, tmp)} (${carried.join(', ')}) SELECT ${carried.join(', ')} FROM ${qtable(schema, table)}`,
    `DROP TABLE ${qtable(schema, table)}`,
    `ALTER TABLE ${qtable(schema, tmp)} RENAME TO ${qi(table)}`,
    ...idxLines
  ]
}

// Current structure → the ColumnSpec[]/Fk[] the rebuild should produce.
function currentColumns(ctx: TableStructure): ColumnSpec[] {
  return ctx.columns
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((c) => ({ name: c.name, type: c.dataType, notNull: !c.nullable, default: c.defaultValue }))
}
function currentFks(ctx: TableStructure): Fk[] {
  return ctx.keys
    .filter((k) => k.kind === 'foreign' && k.referencedTable && k.referencedColumns)
    .map((k) => ({
      name: k.name,
      columns: k.columns,
      refTable: k.referencedTable!,
      refColumns: k.referencedColumns!
    }))
}
```

`Fk` reuses/aligns with `ForeignKeySpec`; keep the small local `Fk` interface for rebuild internals.

Wire the SQLite branches (require context):

```ts
    case 'alterColumn': {
      if (dialect === 'pg') return pgAlterColumn(change)
      if (!context) throw new Error('SQLite alterColumn requires a TableStructure context')
      const columns = currentColumns(context).map((c) =>
        c.name === change.column
          ? {
              ...c,
              ...(change.type !== undefined ? { type: change.type } : {}),
              ...(change.notNull !== undefined ? { notNull: change.notNull } : {}),
              ...(change.default !== undefined ? { default: change.default } : {})
            }
          : c
      )
      return buildSqliteRebuild(context, change.schema, change.table, {
        columns,
        fks: currentFks(context)
      })
    }
    case 'addForeignKey':
      if (dialect === 'pg') return [addForeignKey(change.spec)]
      if (!context) throw new Error('SQLite addForeignKey requires a TableStructure context')
      return buildSqliteRebuild(context, change.spec.schema, change.spec.table, {
        columns: currentColumns(context),
        fks: [
          ...currentFks(context),
          {
            name: change.spec.name,
            columns: change.spec.columns,
            refTable: change.spec.refTable,
            refColumns: change.spec.refColumns
          }
        ]
      })
    case 'dropForeignKey':
      if (dialect === 'pg')
        return [`ALTER TABLE ${qtable(change.schema, change.table)} DROP CONSTRAINT ${qi(change.name)}`]
      if (!context) throw new Error('SQLite dropForeignKey requires a TableStructure context')
      return buildSqliteRebuild(context, change.schema, change.table, {
        columns: currentColumns(context),
        fks: currentFks(context).filter((f) => f.name !== change.name)
      })
```

Update the `buildDdl` signature to `(change: DdlChange, dialect: Dialect, context?: TableStructure)` and add the `TableStructure` import. Remove the Task-2 `throw` placeholder for SQLite `alterColumn`.

- [ ] **Step 4: Run → PASS + commit**

Run: `pnpm vitest run tests/unit/build-ddl.test.ts`, `pnpm typecheck && pnpm lint`.

```bash
git add src/shared/ddl/build-ddl.ts tests/unit/build-ddl.test.ts
git commit -m "feat: buildDdl SQLite native alters + table-rebuild (alter/FK)"
```

---

### Task 4: PgSchemaEditor ops + contract

**Files:**

- Modify: `src/db-host/postgres/postgres-schema.ts`, `tests/contract/adapter-contract.ts`

- [ ] **Step 1: ops**

`PG_OPS` — add `renameColumn: true, dropColumn: true, alterColumn: true`.

- [ ] **Step 2: Contract (PG in-place)**

In the schema-editor contract test (after the existing create/add-column/index/fk/drop block, still on the throwaway table before it is dropped — restructure so the table persists through the alter assertions, then drop at the end), add PG-only column alters guarded on `ed.ops.alterColumn` using the real `buildDdl` path:

```ts
if (ed.ops.renameColumn) {
  await apply({ kind: 'renameColumn', schema: s, table: 'ma3_t', from: 'label', to: 'label2' })
  expect((await adapter.getColumns(s, 'ma3_t')).some((c) => c.name === 'label2')).toBe(true)
}
if (ed.ops.alterColumn && dialect === 'pg') {
  await apply({ kind: 'alterColumn', schema: s, table: 'ma3_t', column: 'label2', notNull: true })
  expect((await adapter.getColumns(s, 'ma3_t')).find((c) => c.name === 'label2')?.nullable).toBe(
    false
  )
}
if (ed.ops.dropColumn) {
  await apply({ kind: 'dropColumn', schema: s, table: 'ma3_t', column: 'label2' })
  expect((await adapter.getColumns(s, 'ma3_t')).some((c) => c.name === 'label2')).toBe(false)
}
```

(These reuse the `apply`/`dialect` helpers already defined in the test. Place them before the final `dropTable`. The SQLite alter/rebuild assertions come in Task 5.)

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm db:up && pnpm test:contract && pnpm db:down`.

```bash
git add src/db-host/postgres/postgres-schema.ts tests/contract/adapter-contract.ts
git commit -m "feat: PgSchemaEditor column-alter ops + contract"
```

---

### Task 5: SqliteSchemaEditor ops + contract (native + rebuild)

**Files:**

- Modify: `src/db-host/sqlite/sqlite-schema.ts`, `tests/contract/adapter-contract.ts`

- [ ] **Step 1: ops**

`SQLITE_OPS` — set `renameColumn: true, dropColumn: true, alterColumn: true`, and flip `addForeignKey: true, dropForeignKey: true`. (`applyDdl` is unchanged — the rebuild's `PRAGMA defer_foreign_keys=ON` is the first batch statement.)

- [ ] **Step 2: Contract (SQLite rebuild, data preserved)**

The Task-4 rename/dropColumn asserts already run for SQLite (native). Add a SQLite-gated rebuild assertion that proves data survives. Because `buildDdl`'s SQLite rebuild needs a `TableStructure`, fetch it from the adapter first:

```ts
if (ed.ops.alterColumn && dialect === 'sqlite') {
  // seed a row, change a column type via rebuild, assert the row survives
  await ed.applyDdl([`INSERT INTO ${qi(s)}.${qi('ma3_t')} ("id") VALUES (7)`])
  const ctx = {
    columns: await adapter.getColumns(s, 'ma3_t'),
    keys: await adapter.getKeys(s, 'ma3_t'),
    indexes: await adapter.getIndexes(s, 'ma3_t')
  }
  await ed.applyDdl(
    buildDdl(
      { kind: 'alterColumn', schema: s, table: 'ma3_t', column: 'id', type: 'BIGINT' },
      'sqlite',
      ctx
    )
  )
  const rows = await adapter.executeQuery(`SELECT id FROM ${qi(s)}.${qi('ma3_t')} WHERE id = 7`)
  expect(rows.rows).toHaveLength(1)
}
```

Add a local `q`/`qi` quoting helper in the test if not already present (reuse the one added in MA3a's schema-editor contract if it is still there; otherwise define `const qi = (id: string) => \`"${id.replace(/"/g, '""')}"\``).

Note: this runs after the Task-4 rename (`label`→`label2`) and dropColumn (`label2` removed), so at this point `ma3_t` has only `id`. The rebuild of a single-column table with the pk is a valid minimal case.

- [ ] **Step 3: Verify + commit**

Run: `pnpm db:up && pnpm test:contract && pnpm db:down` (SQLite instances exercise rename/dropColumn/rebuild), then `pnpm typecheck && pnpm lint && pnpm test`.

```bash
git add src/db-host/sqlite/sqlite-schema.ts tests/contract/adapter-contract.ts
git commit -m "feat: SqliteSchemaEditor rebuild ops + data-preservation contract"
```

---

### Task 6: StructureView — per-column rename/alter/drop + SQLite FK

**Files:**

- Modify: `src/renderer/src/components/StructureView.tsx`

**Interfaces:**

- Consumes: `buildDdl(change, dialect, context)`, the tab's loaded `cols`/`keys`/`indexes` (already fetched), `schemaOps`, the store `applyDdl`.

**Acceptance (implement with the existing StructureView primitives; keep this behavior):**

- Each **column row** gains actions gated on `schemaOps`: **Rename** (`ops.renameColumn`), **Alter** (`ops.alterColumn`), **Drop** (`ops.dropColumn`).
  - Rename → inline input (or `window.prompt`) for the new name → `renameColumn`.
  - Alter → inline form: new type (text), default (text + a "drop default" affordance), nullable toggle. Build an `alterColumn` change carrying ONLY the fields the user changed (omit untouched fields so PG emits minimal statements and the SQLite rebuild is unambiguous).
  - Drop → `dropColumn` (destructive; previewed).
- The **+ FK / drop FK** actions (MA3a) are already gated on `ops.addForeignKey`/`ops.dropForeignKey`; because SQLite now advertises them, they light up for SQLite automatically. **No SQLite-specific branch in the UI** — the difference is entirely inside `buildDdl`.
- **Rebuild context:** every `run(change)` call passes the current structure as `buildDdl`'s third arg: `buildDdl(change, dialect, { columns: cols, keys, indexes })`. (Harmless for PG/native ops, required for SQLite rebuild.) Update the existing `run` helper to always pass context.
- Preview shows the full generated SQL (for a rebuild, the whole sequence) via the existing confirm; apply + error banner unchanged.
- Give the alter/rename inputs stable `aria-label`s (`ddl-rename-<col>` or a shared `ddl-rename`, `ddl-alter-type`) so the e2e can target them.

- [ ] **Step 1: Implement the per-column actions + context passing**

Modify `run` to take `(change)` and call `buildDdl(change, dialect, { columns: cols, keys, indexes })`. Add the per-column Rename/Alter/Drop controls in the Columns panel rows, gated on `ops`. Reuse the inline-form pattern from the existing add-column/index/FK forms.

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Report the controls/aria-labels used.

```bash
git add src/renderer/src/components/StructureView.tsx
git commit -m "feat: StructureView per-column rename/alter/drop + SQLite FK (rebuild context)"
```

---

### Task 7: e2e — SQLite rename + type-change rebuild (data preserved)

**Files:**

- Create: `tests/e2e/structure-alter.spec.ts`

- [ ] **Step 1: e2e**

`tests/e2e/structure-alter.spec.ts` — connect SQLite (a table with a row), open Structure, rename a column (native) and change a column's type (rebuild), asserting the new name appears and the seeded row value survives (query via a data tab or the reconstructed DDL showing the new type). Fresh `--user-data-dir`; auto-accept the confirm dialog (`win.on('dialog', d => d.accept())`). Model the structure and selectors on `tests/e2e/structure.spec.ts` and the `aria-label`s Task 6 renders. Assert:

- after rename, the new column name is visible in the columns panel;
- after the type change, the reconstructed-DDL block shows the new type (e.g. `NUMERIC`);
- open the table's data tab and confirm the pre-existing row is still present (a known value visible), proving the rebuild preserved data.

- [ ] **Step 2: Run + commit**

Run: `pnpm build && pnpm e2e tests/e2e/structure-alter.spec.ts` (retry once if the first launch is a cold-start flake).

```bash
git add tests/e2e/structure-alter.spec.ts
git commit -m "test: SQLite column rename + rebuild e2e (data preserved)"
```

---

## Self-Review (done at plan time)

1. **Spec coverage:** referencedColumns introspection (spec §Introspection) → Task 1; PG in-place alters (§DDL/Postgres) → Task 2 + 4; SQLite native + rebuild (§DDL/SQLite, §Data flow) → Task 3 + 5; ops gating (§SchemaOps) → 4/5, enforced in UI 6; UI per-column edit (§Renderer) → Task 6; testing (§Testing) → unit (2,3), contract (1,4,5), e2e (7).
2. **Placeholder scan:** Full code in Tasks 1–5, 7-shape. Task 6 acceptance-defined (mirrors MA3a's grid/StructureView task) with every consumed contract (`buildDdl` 3-arg, `applyDdl`, `schemaOps`, introspection) fully specified.
3. **Type consistency:** `KeyInfo.referencedColumns`, `TableStructure`, new `SchemaOps` fields and `DdlChange` kinds (Task 1) used verbatim in 2–6. `buildDdl(change, dialect, context?)` (2/3) consumed by 6. `buildSqliteRebuild` internals (`Fk`, `currentColumns`, `currentFks`) are Task-3-local. Contract `apply`/`dialect`/`qi` helpers reused across the schema-editor test (Tasks 4/5 extend the MA3a block).

**Known deliberate deferrals:** column reordering, generated/computed columns, check constraints, PG `USING` cast expressions, cross-table rebuild coordination beyond `defer_foreign_keys`.

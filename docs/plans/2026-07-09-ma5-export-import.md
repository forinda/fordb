# fordb MA5 — Export / Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export a table / whole database as a SQL script (structure + escaped INSERTs, optional gzip); import a `.sql` file transactionally; import a CSV into a table with column mapping.

**Architecture:** Export is renderer-orchestrated over existing RPC (`reconstructDdl` + `openQuery` streaming) with pure `renderSqlLiteral`/`buildInsert`, saved via a new main file-save IPC (gzip in main). Import adds one transactional `HostApi.executeScript`; CSV import reuses the existing `dataMutator`. Pure `splitStatements` + `parseCsv`.

**Tech Stack:** TypeScript strict, Electron IPC + `node:zlib`, `pg`, `@libsql/client`, React 19, Zustand, vitest, Playwright.

## Global Constraints

- pnpm; Node >= 22; TypeScript strict; no `any` except typed IPC/DB-boundary casts.
- No secrets in exported scripts (SQL text only); secrets stay in main/keychain.
- Electron has no `window.prompt` — name/mapping entry uses inline inputs/dialogs.
- Identifiers quoted via `quoteIdent`; exported values escaped via `renderSqlLiteral` (valid re-runnable SQL).
- Import runs in a single transaction (rollback on any error).
- `@shared/*` alias. Renderer-importing tests → `tsconfig.web`; pure/main tests → `tsconfig.node`.
- Each task ends `pnpm typecheck && pnpm lint && pnpm test` (+ `pnpm build`; contract tasks `pnpm db:up && pnpm test:contract && pnpm db:down`). One PR per task against `main`.

## File Structure (end state)

```
src/shared/sql/literal.ts                      # NEW: renderSqlLiteral
src/shared/sql/build-insert.ts                 # NEW: buildInsert
src/shared/sql/split-statements.ts             # NEW: splitStatements
src/shared/csv/csv.ts                          # NEW: parseCsv + stringifyCsv
src/shared/host/host-api.ts                    # MODIFY: executeScript
src/db-host/host-api-impl.ts                   # MODIFY: route executeScript
src/main/ipc.ts                                # MODIFY: export:save + read-text; open .sql/.csv
src/preload/index.ts                           # MODIFY: exportFile.save + dialog.openFile filters + readTextFile
src/renderer/src/rpc.ts                        # MODIFY: typings
src/renderer/src/store-query.ts                # MODIFY: exportSql, importSqlFile, importCsv
src/renderer/src/components/QueryWorkbench.tsx  # MODIFY: use shared csv
src/renderer/src/components/CsvImportDialog.tsx # NEW: column mapping
src/renderer/src/components/SchemaTree.tsx      # MODIFY: Export/Import context items
src/renderer/src/App.tsx                        # MODIFY: palette commands
tests/unit/literal.test.ts · build-insert.test.ts · split-statements.test.ts · csv.test.ts   # NEW
tests/contract/host-api.contract.test.ts        # MODIFY: executeScript
tests/e2e/export-import.spec.ts                 # NEW
```

---

### Task 1: `renderSqlLiteral` + `buildInsert`

**Files:** Create `src/shared/sql/literal.ts`, `src/shared/sql/build-insert.ts`, `tests/unit/literal.test.ts`, `tests/unit/build-insert.test.ts`.

- [ ] **Step 1: Failing tests**

`tests/unit/literal.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderSqlLiteral } from '../../src/shared/sql/literal'

describe('renderSqlLiteral', () => {
  it('null → NULL', () => {
    expect(renderSqlLiteral(null, 'pg')).toBe('NULL')
    expect(renderSqlLiteral(undefined, 'sqlite')).toBe('NULL')
  })
  it('numbers and bigints raw', () => {
    expect(renderSqlLiteral(42, 'pg')).toBe('42')
    expect(renderSqlLiteral(10n, 'pg')).toBe('10')
  })
  it('booleans per dialect', () => {
    expect(renderSqlLiteral(true, 'pg')).toBe('TRUE')
    expect(renderSqlLiteral(false, 'sqlite')).toBe('0')
  })
  it("strings single-quoted with '' escaping", () => {
    expect(renderSqlLiteral("O'Brien", 'pg')).toBe("'O''Brien'")
  })
  it('bytes as hex per dialect', () => {
    expect(renderSqlLiteral(new Uint8Array([0xde, 0xad]), 'pg')).toBe(`'\\xdead'::bytea`)
    expect(renderSqlLiteral(new Uint8Array([0xde, 0xad]), 'sqlite')).toBe(`X'dead'`)
  })
  it('objects JSON-stringified then quoted', () => {
    expect(renderSqlLiteral({ a: 1 }, 'pg')).toBe(`'{"a":1}'`)
  })
})
```

`tests/unit/build-insert.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildInsert } from '../../src/shared/sql/build-insert'

describe('buildInsert', () => {
  it('quotes idents, escapes values', () => {
    expect(buildInsert('app', 'users', ['id', 'name'], [1, "O'Brien"], 'pg')).toBe(
      `INSERT INTO "app"."users" ("id", "name") VALUES (1, 'O''Brien')`
    )
  })
})
```

- [ ] **Step 2: Run → FAIL**, then implement.

`src/shared/sql/literal.ts`:

```ts
type Dialect = 'pg' | 'sqlite'

const quote = (s: string): string => `'${s.replace(/'/g, "''")}'`
const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

export function renderSqlLiteral(value: unknown, dialect: Dialect): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean')
    return dialect === 'pg' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0'
  if (value instanceof Uint8Array)
    return dialect === 'pg' ? `'\\x${hex(value)}'::bytea` : `X'${hex(value)}'`
  if (typeof value === 'string') return quote(value)
  if (value instanceof Date) return quote(value.toISOString())
  return quote(JSON.stringify(value)) // json/array/other
}
```

`src/shared/sql/build-insert.ts`:

```ts
import { quoteIdent } from '../mutation/build-edits'
import { renderSqlLiteral } from './literal'

export function buildInsert(
  schema: string,
  table: string,
  columns: string[],
  row: unknown[],
  dialect: 'pg' | 'sqlite'
): string {
  const cols = columns.map(quoteIdent).join(', ')
  const vals = row.map((v) => renderSqlLiteral(v, dialect)).join(', ')
  return `INSERT INTO ${quoteIdent(schema)}.${quoteIdent(table)} (${cols}) VALUES (${vals})`
}
```

- [ ] **Step 3: Run → PASS + commit**

```bash
git add src/shared/sql/literal.ts src/shared/sql/build-insert.ts tests/unit/literal.test.ts tests/unit/build-insert.test.ts
git commit -m "feat: renderSqlLiteral + buildInsert (escaped dump literals)"
```

---

### Task 2: `splitStatements` + shared CSV

**Files:** Create `src/shared/sql/split-statements.ts`, `src/shared/csv/csv.ts`, `tests/unit/split-statements.test.ts`, `tests/unit/csv.test.ts`. Modify `src/renderer/src/components/QueryWorkbench.tsx`.

- [ ] **Step 1: Failing tests**

`tests/unit/split-statements.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { splitStatements } from '../../src/shared/sql/split-statements'

describe('splitStatements', () => {
  it('splits on top-level semicolons', () => {
    expect(splitStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2'])
  })
  it('ignores semicolons in strings and comments', () => {
    expect(splitStatements(`INSERT INTO t VALUES ('a;b'); -- c;d\nSELECT 1;`)).toEqual([
      `INSERT INTO t VALUES ('a;b')`,
      'SELECT 1'
    ])
  })
  it('ignores block comments and trims empties', () => {
    expect(splitStatements('/* a;b */ SELECT 1;;')).toEqual(['SELECT 1'])
  })
})
```

`tests/unit/csv.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseCsv, stringifyCsv } from '../../src/shared/csv/csv'

describe('csv', () => {
  it('parses quoted fields with commas, newlines, and "" escapes', () => {
    expect(parseCsv('a,b\n"x,y","he said ""hi""\nz"')).toEqual([
      ['a', 'b'],
      ['x,y', 'he said "hi"\nz']
    ])
  })
  it('round-trips through stringify', () => {
    const rows = [
      ['id', 'note'],
      ['1', 'a,b'],
      ['2', 'c"d']
    ]
    expect(parseCsv(stringifyCsv(rows))).toEqual(rows)
  })
})
```

- [ ] **Step 2: Run → FAIL**, then implement.

`src/shared/sql/split-statements.ts`:

```ts
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === "'" || c === '"') {
      cur += c
      i++
      while (i < sql.length) {
        cur += sql[i]
        if (sql[i] === c && sql[i + 1] !== c) {
          i++
          break
        }
        if (sql[i] === c && sql[i + 1] === c) {
          cur += sql[i + 1]
          i += 2
          continue
        }
        i++
      }
      continue
    }
    if (c === ';') {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      i++
      continue
    }
    cur += c
    i++
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
```

`src/shared/csv/csv.ts`:

```ts
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  let quoted = false
  const pushField = (): void => {
    row.push(field)
    field = ''
  }
  const pushRow = (): void => {
    pushField()
    rows.push(row)
    row = []
  }
  while (i < text.length) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i += 2
        continue
      }
      if (c === '"') {
        quoted = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      quoted = true
      i++
      continue
    }
    if (c === ',') {
      pushField()
      i++
      continue
    }
    if (c === '\r') {
      i++
      continue
    }
    if (c === '\n') {
      pushRow()
      i++
      continue
    }
    field += c
    i++
  }
  // Flush trailing field/row unless the input ended exactly on a newline.
  if (field !== '' || row.length > 0) pushRow()
  return rows
}

export function stringifyCsv(rows: string[][]): string {
  const cell = (s: string): string => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return rows.map((r) => r.map(cell).join(',')).join('\n')
}
```

- [ ] **Step 3: Refactor QueryWorkbench to shared csv**

In `QueryWorkbench.tsx`, replace the local `toCsv` with `stringifyCsv` from `@shared/csv/csv` (build the rows as `string[][]` — coerce cells to strings first). Remove the now-dead `toCsv`.

- [ ] **Step 4: Run → PASS + commit**

```bash
git add src/shared/sql/split-statements.ts src/shared/csv/csv.ts tests/unit/split-statements.test.ts tests/unit/csv.test.ts src/renderer/src/components/QueryWorkbench.tsx
git commit -m "feat: splitStatements + shared parseCsv/stringifyCsv"
```

---

### Task 3: `HostApi.executeScript` (transactional) + contract

**Files:** Modify `src/shared/host/host-api.ts`, `src/db-host/host-api-impl.ts`, `tests/contract/host-api.contract.test.ts`.

**Interfaces:** Produces `HostApi.executeScript(id, statements: string[]): Promise<void>`.

- [ ] **Step 1: Interface + routing**

`host-api.ts` — add after `applyDdl`:

```ts
  /** Run a list of statements in one transaction (import a .sql file). */
  executeScript(id: ConnectionId, statements: string[]): Promise<void>
```

`host-api-impl.ts` — implement by reusing the engine's transactional runner. Both current engines expose `schemaEditor.applyDdl`, which runs an arbitrary statement list in a transaction; delegate to it (throw if absent):

```ts
  executeScript(id: ConnectionId, statements: string[]): Promise<void> {
    const e = this.registry.get(id).schemaEditor
    if (!e) throw new Error('Script execution is not supported by this engine')
    return e.applyDdl(statements)
  }
```

(Comment: `applyDdl` is the shared transactional statement runner — it does not validate that statements are DDL, so it correctly runs INSERTs/mixed scripts too.)

- [ ] **Step 2: Contract**

In `tests/contract/host-api.contract.test.ts` add:

```ts
it('executeScript runs statements in one transaction; rolls back on error', async () => {
  const id = await client.openConnection(profile)
  await client.executeScript(id, [`DROP TABLE app.ma5_s`]).catch(() => {})
  await client.executeScript(id, [
    `CREATE TABLE app.ma5_s ("id" integer NOT NULL, PRIMARY KEY ("id"))`,
    `INSERT INTO app.ma5_s ("id") VALUES (1)`,
    `INSERT INTO app.ma5_s ("id") VALUES (2)`
  ])
  const r = await client.executeQuery(id, `SELECT count(*) FROM app.ma5_s`)
  expect(Number(r.rows[0]?.[0])).toBe(2)
  // A failing statement rolls back the whole batch.
  await expect(
    client.executeScript(id, [
      `INSERT INTO app.ma5_s ("id") VALUES (3)`,
      `INSERT INTO app.ma5_s ("id") VALUES (1)` // pk conflict
    ])
  ).rejects.toThrow()
  const r2 = await client.executeQuery(id, `SELECT count(*) FROM app.ma5_s`)
  expect(Number(r2.rows[0]?.[0])).toBe(2) // 3 was rolled back
  await client.executeScript(id, [`DROP TABLE app.ma5_s`])
  await client.closeConnection(id)
})
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm db:up && pnpm test:contract && pnpm db:down`.

```bash
git add src/shared/host/host-api.ts src/db-host/host-api-impl.ts tests/contract/host-api.contract.test.ts
git commit -m "feat: HostApi.executeScript (transactional multi-statement) + contract"
```

---

### Task 4: Export (main save IPC + store orchestration + UI)

**Files:** Modify `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/rpc.ts`, `src/renderer/src/store-query.ts`, `src/renderer/src/components/SchemaTree.tsx`, `src/renderer/src/App.tsx`.

**Interfaces:** Produces `window.fordb.exportFile.save(defaultName, text, gzip)`; store `exportSql(scope, gzip)`.

- [ ] **Step 1: main save IPC**

In `ipc.ts` add (imports: `dialog`, `writeFile` from `node:fs/promises`, `gzipSync` from `node:zlib`):

```ts
ipcMain.handle('export:save', async (_e, defaultName: string, text: string, gzip: boolean) => {
  const r = await dialog.showSaveDialog({ defaultPath: gzip ? `${defaultName}.gz` : defaultName })
  if (r.canceled || !r.filePath) return false
  await writeFile(r.filePath, gzip ? gzipSync(Buffer.from(text, 'utf8')) : text)
  return true
})
```

- [ ] **Step 2: preload + typing**

`preload/index.ts` add:

```ts
  exportFile: {
    save: (defaultName: string, text: string, gzip: boolean): Promise<boolean> =>
      ipcRenderer.invoke('export:save', defaultName, text, gzip)
  },
```

`rpc.ts`: add `exportFile: { save: (defaultName: string, text: string, gzip: boolean) => Promise<boolean> }` to the `fordb` interface.

- [ ] **Step 3: store `exportSql`**

In `store-query.ts` add `exportSql: (scope, gzip, dialect) => Promise<void>` where `scope = { kind:'table'; schema; table } | { kind:'database'; schema }`:

```ts
  exportSql: async (scope, gzip, dialect) => {
    const connId = useConnStore.getState().activeConnectionId
    if (!connId) return
    const api = await hostApi()
    const tables =
      scope.kind === 'table'
        ? [scope.table]
        : (await api.listTables(scope.schema)).filter((t) => t.type === 'table').map((t) => t.name)
    const parts: string[] = ['-- fordb dump\n']
    for (const table of tables) {
      const [cols, keys, indexes] = await Promise.all([
        api.getColumns(scope.schema, table),
        api.getKeys(scope.schema, table),
        api.getIndexes(scope.schema, table)
      ])
      parts.push(reconstructDdl(cols, keys, indexes, scope.schema, table, dialect) + '\n')
      const colNames = cols.map((c) => c.name)
      const open = await api.openQuery(connId, `SELECT * FROM ${qid(scope.schema)}.${qid(table)}`, 1000)
      let page = await api.fetchPage(connId, open.queryId)
      while (true) {
        for (const row of page.rows)
          parts.push(buildInsert(scope.schema, table, colNames, row, dialect) + ';\n')
        if (page.done) break
        page = await api.fetchPage(connId, open.queryId)
      }
      parts.push('\n')
    }
    const name = scope.kind === 'table' ? `${scope.table}.sql` : `${scope.schema}.sql`
    await window.fordb.exportFile.save(name, parts.join(''), gzip)
  },
```

Add a local `qid` (`"`-escape) helper or import `quoteIdent`. Import `reconstructDdl`, `buildInsert`.

- [ ] **Step 4: UI**

Schema-tree table context menu: **Export (SQL)** → `exportSql({kind:'table',...}, false, dialect)` (and a gzip variant or a small choose). Schema node menu: **Export database (SQL)**. Palette: **Export database (SQL)** for the active schema (use the first/default schema or the active one). A minimal gzip toggle can be a second menu item "Export (SQL, gzip)".

- [ ] **Step 5: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/src/rpc.ts src/renderer/src/store-query.ts src/renderer/src/components/SchemaTree.tsx src/renderer/src/App.tsx
git commit -m "feat: export table/database to SQL (structure + INSERTs, gzip)"
```

---

### Task 5: Import a `.sql` file

**Files:** Modify `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/rpc.ts`, `src/renderer/src/store-query.ts`, `src/renderer/src/App.tsx`.

**Interfaces:** `window.fordb.dialog.openTextFile(filters)` (open + read text); store `importSqlFile()`.

- [ ] **Step 1: main open+read**

In `ipc.ts` add a handler that opens a file dialog and returns its text (or null):

```ts
ipcMain.handle('dialog:open-text', async (_e, exts: string[]) => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'File', extensions: exts },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (r.canceled || r.filePaths.length === 0) return null
  return { name: r.filePaths[0], text: await readFile(r.filePaths[0], 'utf8') }
})
```

- [ ] **Step 2: preload + typing**

```ts
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:open-file'),
    openTextFile: (exts: string[]): Promise<{ name: string; text: string } | null> =>
      ipcRenderer.invoke('dialog:open-text', exts)
  },
```

Add the typing to `rpc.ts`.

- [ ] **Step 3: store `importSqlFile`**

```ts
  importSqlFile: async () => {
    const connId = useConnStore.getState().activeConnectionId
    if (!connId) return
    const picked = await window.fordb.dialog.openTextFile(['sql'])
    if (!picked) return
    const api = await hostApi()
    await api.executeScript(connId, splitStatements(picked.text))
    void invalidateIntrospection(queryClient, connId)
  },
```

Import `splitStatements`. Surface errors (the caller/command shows a banner or the workbench error state — reuse the schema-tree/structure error pattern or a simple alert-free banner).

- [ ] **Step 4: UI**

Palette command **Import SQL file** → `importSqlFile()`.

- [ ] **Step 5: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/src/rpc.ts src/renderer/src/store-query.ts src/renderer/src/App.tsx
git commit -m "feat: import a .sql file (statement-split, transactional)"
```

---

### Task 6: Import CSV into a table (column mapping)

**Files:** Create `src/renderer/src/components/CsvImportDialog.tsx`. Modify `src/renderer/src/store-query.ts`, `src/renderer/src/components/SchemaTree.tsx`.

**Interfaces:** store `beginCsvImport(schema, table)` + `applyCsvImport(schema, table, mapping, rows)`; `CsvImportDialog`.

**Acceptance:**

- Schema-tree table menu **Import CSV…** → `beginCsvImport(schema, table)`: opens a `.csv` via `openTextFile(['csv'])`, `parseCsv`, splits header + data rows, and opens `CsvImportDialog`.
- `CsvImportDialog`: for each CSV header column, a `<select>` mapping it to a target column (from `getColumns`) or "skip". A header row auto-maps columns whose names match. **Import** builds one `insert` `RowEdit` per data row (`values` = the mapped `{column, value}` cells, value as the CSV string; unmapped CSV columns dropped) → `applyEdits` (transactional via `dataMutator`). Row-count / errors surface in the dialog.
- Guard: table must be mutable (`dataMutator` present) — reuse `mutationSupported`.

- [ ] **Step 1: Implement dialog + store actions**

Build per acceptance. Reuse the `RowEdit` insert shape (`{ kind: 'insert', schema, table, values: Cell[] }`) and the existing `applyEdits(tabId?, edits)` path — note `applyEdits` is tab-scoped for the grid; for CSV import call `window.fordb`'s mutator via a store action that invokes `hostApi().applyEdits(connId, edits)` directly and then invalidates/optionally refreshes.

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Report the dialog primitive used.

```bash
git add src/renderer/src/components/CsvImportDialog.tsx src/renderer/src/store-query.ts src/renderer/src/components/SchemaTree.tsx
git commit -m "feat: import CSV into a table with column mapping"
```

---

### Task 7: e2e — export a table + CSV import (headless SQLite)

**Files:** Create `tests/e2e/export-import.spec.ts`.

- [ ] **Step 1: e2e**

Because the native save/open dialogs can't be driven headlessly, stub them: in the test, before actions, use Playwright/Electron to intercept — OR assert the store-level path by evaluating in the renderer. Practical approach: drive the CSV-import dialog UI (the file pick is the only native step) by pre-seeding via `app.evaluate` to call the store action with an in-memory CSV, OR mock `window.fordb.dialog.openTextFile` / `exportFile.save` via `page.addInitScript`. Use `page.addInitScript` to replace `window.fordb.exportFile.save` with a capture and `openTextFile` with a fixture, then:

- Connect SQLite (a table with a row), trigger **Export (SQL)** from the table menu, assert the captured text contains `CREATE TABLE` and `INSERT`.
- Trigger **Import CSV…**, (openTextFile returns a fixture CSV), map columns, Import, then open the table's data tab / run a count to assert the new rows are present.

(Keep the e2e focused on the export-text assertion + CSV round-trip; the SQL-file import path is covered by the executeScript contract.)

- [ ] **Step 2: Run + commit**

Run: `pnpm build && pnpm e2e tests/e2e/export-import.spec.ts` (retry once on cold-start).

```bash
git add tests/e2e/export-import.spec.ts
git commit -m "test: export SQL + CSV import e2e (headless SQLite)"
```

---

## Self-Review (done at plan time)

1. **Spec coverage:** literals/insert (spec §Pure helpers) → Task 1; splitter + csv → Task 2; executeScript (§Import SQL) → Task 3; export (§Export) → Task 4; SQL import (§Import SQL) → Task 5; CSV import (§Import CSV) → Task 6; testing → unit (1,2), contract (3), e2e (7).
2. **Placeholder scan:** Full code in Tasks 1–5. Tasks 6–7 acceptance-defined (dialog/menu wiring + headless dialog stubbing follow existing primitives) with every consumed contract (`parseCsv`, `applyEdits`/`dataMutator`, `openTextFile`, `exportFile.save`, `executeScript`) fully specified.
3. **Type consistency:** `renderSqlLiteral(value, dialect)` (1) used by `buildInsert` (1) + `exportSql` (4). `splitStatements` (2) used by `importSqlFile` (5). `parseCsv` (2) used by CSV import (6) and `stringifyCsv` replaces `toCsv` (2). `executeScript(id, statements)` (3) consumed by `importSqlFile` (5). `RowEdit` insert shape reused by CSV import (6).

**Known deliberate deferrals:** COPY/binary dumps, streaming-to-disk for huge tables, PG dollar-quote splitting, type-aware CSV coercion, import conflict/upsert handling.

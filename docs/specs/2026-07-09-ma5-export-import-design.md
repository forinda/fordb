# MA5 — Export / Import (Dump & Load) (Design)

**Status:** approved scope (full: SQL dump + SQL import + CSV import), ready for plan
**Date:** 2026-07-09
**Milestone:** MA5

## Goal

Move data in and out of a connection: **export** a table or whole database as a SQL script (structure + escaped `INSERT`s, optional gzip); **import** by running a `.sql` file transactionally or loading a CSV into a table with column mapping. All from the command palette / query toolbar.

## Scope

### In (MA5)

- **Export SQL** — one table or the whole database (all tables in a schema): reconstructed `CREATE TABLE` (via the existing `reconstructDdl`) + `INSERT` statements with correctly-escaped literals. Optional gzip (`.sql.gz`). Saved via a native save dialog.
- **Import a `.sql` file** — pick a file, split into statements, run in a single transaction (rolls back on any error).
- **Import a CSV** — pick a CSV, map its columns to a target table's columns, insert the rows (transactional, via the existing `dataMutator`).

### Out (future)

- `COPY`/binary/native-format dumps; server-side `pg_dump`; cross-engine transform on import.
- Streaming a multi-GB dump straight to disk (v1 accumulates the script in memory, then saves once — see Limitations).
- Type-aware CSV coercion beyond string/number/null; import upsert/conflict handling.

## Architecture

Reuses existing RPC and capabilities — **no new adapter capability for export**; import adds one small transactional-script method on `HostApi`.

### Pure helpers (shared, unit-tested)

- `src/shared/sql/literal.ts` — `renderSqlLiteral(value, dialect): string`:
  - `null`/`undefined` → `NULL`
  - number / bigint → `String(v)`
  - boolean → `TRUE`/`FALSE` (pg), `1`/`0` (sqlite)
  - `Uint8Array`/Buffer → `'\xHEX'::bytea` (pg), `X'HEX'` (sqlite)
  - everything else (string, Date, json/array objects) → single-quoted with `'`→`''` escaping (objects `JSON.stringify`'d first)
- `src/shared/sql/build-insert.ts` — `buildInsert(schema, table, columns, row, dialect): string` → `INSERT INTO "s"."t" ("c1","c2") VALUES (lit, lit)` (identifiers quoted; values via `renderSqlLiteral`). SQLite qualifies as `"s"."t"` where `s` is the attached-db name (works for `main`).
- `src/shared/sql/split-statements.ts` — `splitStatements(sql): string[]` → split on `;` that is NOT inside a single/double-quoted string, a line comment (`-- …`), or a block comment (`/* … */`); trims empties. A pragmatic splitter (documented: it does not parse dollar-quoted PG bodies — MA5 imports are fordb's own dumps + simple scripts).
- `src/shared/csv/csv.ts` — `parseCsv(text): string[][]` (RFC-4180: quoted fields, `""` escapes, commas/newlines inside quotes) and `stringifyCsv(rows): string`. Replaces the ad-hoc `toCsv` in `QueryWorkbench`.

### Export (renderer-orchestrated + main file I/O)

The renderer already has everything to read a table over RPC. A store action assembles the script:

```
exportSql(scope: { kind: 'table'; schema; table } | { kind: 'database'; schema }, gzip: boolean)
```

1. For each table: `getColumns`/`getKeys`/`getIndexes` → `reconstructDdl(...)` (the `CREATE TABLE` + indexes).
2. `openQuery("SELECT * FROM \"s\".\"t\"")` → page rows via `fetchPage` until done → `buildInsert(...)` per row.
3. Concatenate `-- fordb dump` header + per-table (DDL + INSERTs).
4. Hand the final text to main: `window.fordb.exportFile.save(defaultName, text, gzip)` → `dialog.showSaveDialog` → write (`zlib.gzipSync` when `gzip`).

Dialect from the active connection's engine (`useDialect`). No secrets involved (SQL text only).

### Import SQL (`.sql` file)

- New `HostApi.executeScript(id, statements: string[]): Promise<void>` — runs the statements in a single transaction on the engine (Postgres: dedicated `pg.Client`, `BEGIN…COMMIT`, rollback on error; SQLite: `batch(statements, 'write')`). This is the same transactional runner shape the schema editors already use; expose it as a first-class HostApi method so import doesn't ride on the DDL capability.
- Renderer `importSqlFile()`: `window.fordb.dialog.openFile()` (extended to accept `.sql`) → main reads the file text → renderer `splitStatements` → `executeScript(connId, statements)` → invalidate introspection (the script may create/alter tables). Errors surface in a banner.

### Import CSV

- Renderer `importCsv(schema, table)`: open a `.csv` file → `parseCsv` → first row = headers → a **column-mapping** dialog (each CSV column → a target table column or "skip", target columns from `getColumns`) → build `insert` `RowEdit`s (`dataMutator` shape) → `applyEdits`/`applyDdl`-style transactional apply via the existing `dataMutator.apply`. Values are inserted as strings; the engine coerces to the column type (documented).

### Renderer surface

Command palette + toolbar/menu entries: **Export table (SQL)**, **Export database (SQL)**, **Import SQL file**, **Import CSV into table…**. Export/CSV-import that target a specific table are also reachable from the schema-tree table context menu. A small dialog handles gzip choice (export) and column mapping (CSV import); name entry is inline (no `window.prompt`).

## Data flow (dump a table, restore it)

1. Right-click a table → **Export (SQL)** → choose gzip → save dialog → `dump.sql`.
2. Later, on an empty database: **Import SQL file** → pick `dump.sql` → statements split → `executeScript` in a transaction → tables + rows recreated.

## Error handling

- Export read failure (dropped connection mid-dump) → banner, partial file not saved (assembled fully before the save call).
- Import: any statement failing rolls back the whole transaction (nothing partially applied); the engine error surfaces in a banner.
- Malformed CSV → `parseCsv` still returns best-effort rows; a row whose mapped column count mismatches is reported, not silently dropped.
- File dialogs cancelled → no-op.

## Security

- No secrets in exported scripts (SQL/structure/data only). Secrets stay in main/keychain, never reach the renderer (unchanged).
- Exported literals are correctly escaped (`renderSqlLiteral`) so a dump is valid, re-runnable SQL; imported SQL is the user's own file run under their connection (no injection frame — it is their statement).

## Limitations (documented)

- v1 assembles the whole dump in renderer memory before saving — fine for typical tables, not for multi-GB ones (streaming-to-disk is a later refinement).
- `renderSqlLiteral` covers null/number/bool/bytea/string/JSON; exotic engine types are stringified+quoted (may need a manual tweak on restore).
- `splitStatements` is a pragmatic splitter (no PG dollar-quoting); adequate for fordb dumps and simple scripts.
- CSV import inserts strings and relies on engine coercion; no per-column type parsing in v1.
- `timestamp without time zone` round-trip: the `Date` branch renders via `toISOString()` (UTC); on a db-host whose local TZ is not UTC this can shift a tz-naive timestamp by the offset. Type-aware rendering would fix it — deferred.
- Export/import of **views** is not offered (a view would be frozen into a mislabeled static table); whole-database export already skips views.

## Testing

- **Unit**: `renderSqlLiteral` (each type × dialect, quote-escaping, bytea hex); `buildInsert`; `splitStatements` (semicolons in strings/comments, trailing/empty); `parseCsv`/`stringifyCsv` (quoted fields, embedded commas/newlines, `""`).
- **Contract**: `executeScript` round-trip (create a temp table + insert rows in one transaction, assert present; a failing statement rolls back) — capability-gated, both engines.
- **e2e** (headless SQLite): export a table to SQL (assert the saved file has `CREATE TABLE` + `INSERT`), and CSV import (map columns, assert rows land).

## Exit criteria

Dump a table and the whole database to SQL (with gzip); restore a dump into an empty database via SQL-file import; import a CSV into a table with column mapping — all from the palette / table menu.

## Task decomposition (for the plan)

1. Pure `renderSqlLiteral` + `buildInsert` + unit tests.
2. Pure `splitStatements` + `parseCsv`/`stringifyCsv` (+ refactor `QueryWorkbench` to the shared csv) + unit tests.
3. `HostApi.executeScript` (transactional, both engines) + contract test.
4. Export: main `exportFile.save` ipc (dialog + gzip) + preload + `exportSql` store orchestration + UI (table + database).
5. Import SQL file: renderer `importSqlFile` (open → split → executeScript) + UI.
6. Import CSV: parse + column-mapping dialog + insert via `dataMutator` + UI.
7. e2e (export table + CSV import, headless SQLite).

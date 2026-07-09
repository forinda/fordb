# MA4 — Query Power Tools (Design)

**Status:** approved scope (all four + sql-formatter), ready for plan
**Date:** 2026-07-09
**Milestone:** MA4

## Goal

Four editor-productivity tools, all reachable from the command palette (Ctrl/Cmd-K) and the query toolbar: **EXPLAIN / EXPLAIN ANALYZE** with a formatted plan view; persistent **query history** (per-connection); named **saved queries** (per-connection); and a **SQL format** command.

## Scope

### In (MA4)

- **Format SQL** — prettify the active query tab's SQL in place (dialect-aware, via `sql-formatter`).
- **EXPLAIN / EXPLAIN ANALYZE** — run the active statement's plan and show it in a dedicated plan view. Postgres: `EXPLAIN [ANALYZE] <sql>`. SQLite: `EXPLAIN QUERY PLAN <sql>` (no ANALYZE — button hidden/disabled for SQLite).
- **Query history** — every successful user run appends `{sql, ts}` to a per-profile, capped history. A "Query history" picker lists recent entries; selecting one loads it into the active editor.
- **Saved queries** — name and store the active SQL per profile; an "Open saved query" picker lists them (load / delete).
- **Editor theming** — the CodeMirror SQL editor tracks the app light/dark theme (syntax colors, selection, gutters, cursor) via a theme extension driven by the existing `appearance` signal — not a separate editor toggle.

### Out (future)

- Plan visualization (graphical/tree EXPLAIN, cost heat-maps) — the view is formatted text in v1.
- Cross-connection history/saved sharing; history search/full-text; export of saved queries.
- Autocomplete of saved-query names; parameterized saved queries.

## Architecture

### Persistence (main)

One new store file `src/main/query-library-store.ts` holding **both** history and saved queries in a single JSON file (`query-library.json` under `userData`), mirroring `SettingsStore`/`ProfileStore` (async read-modify-write, ENOENT → empty).

```ts
interface HistoryEntry {
  sql: string
  ts: number
}
interface SavedQuery {
  id: string
  name: string
  sql: string
  createdAt: number
}
interface LibraryFile {
  history?: Record<string, HistoryEntry[]> // keyed by profileId, newest-first, capped
  saved?: Record<string, SavedQuery[]> // keyed by profileId
}

class QueryLibraryStore {
  addHistory(profileId: string, sql: string): Promise<void> // prepend, dedup consecutive, cap 200
  listHistory(profileId: string): Promise<HistoryEntry[]>
  saveQuery(profileId: string, name: string, sql: string): Promise<SavedQuery>
  listSaved(profileId: string): Promise<SavedQuery[]>
  deleteSaved(profileId: string, id: string): Promise<void>
}
```

- History is **not secret-bearing** (SQL text only — no connection secrets), so it lives in plain JSON like profiles-minus-secrets. Documented: users should avoid embedding literal credentials in SQL; history stores whatever SQL was run.
- Cap 200 newest per profile; dedup when the new SQL equals the most-recent entry.
- `id` for saved queries: `s{counter}` from an in-file counter (no `Date.now()`/random in a deterministic path is unnecessary here — main can use `Date.now()` for `ts`/`createdAt`; ids use a monotonic counter persisted in the file).

### IPC + preload

New `window.fordb.queries` surface (ipcMain.handle + preload bridge, same shape as `profiles`):

```ts
queries: {
  historyList: (profileId: string) => Promise<HistoryEntry[]>
  historyAdd: (profileId: string, sql: string) => Promise<void>
  savedList: (profileId: string) => Promise<SavedQuery[]>
  save: (profileId: string, name: string, sql: string) => Promise<SavedQuery>
  deleteSaved: (profileId: string, id: string) => Promise<void>
}
```

Addressed by `profileId` (the active connection's profile), consistent with how the renderer already tracks `activeProfileId`.

### Pure helpers (shared)

`src/shared/sql/explain.ts` — `buildExplain(sql, dialect, analyze): string`:

- pg: `EXPLAIN ANALYZE <sql>` or `EXPLAIN <sql>`
- sqlite: `EXPLAIN QUERY PLAN <sql>` (analyze ignored)
  Trims a trailing `;`. Pure + unit-tested.

SQL formatting uses the `sql-formatter` package directly in the renderer (`format(sql, { language })`), `language` = `'postgresql'` | `'sqlite'`.

### Renderer

- **Dialect**: a small `useDialect()` hook (profiles + `activeProfileId` → `'pg' | 'sqlite'` and the `sql-formatter` language), factored out of the inline copies now in `StructureView`/`SchemaTree`.
- **Format**: store action `formatActive()` (or a command) formats the active `query` tab's `sql` via `sql-formatter` and calls `setSql`. Wired to a toolbar button + palette command "Format SQL".
- **EXPLAIN**: store `openExplain(analyze)` opens a new tab of a new kind `'explain'` carrying the built explain SQL; `run()` executes it via `executeQuery` and the tab renders the plan rows in a monospace `<pre>` (`ExplainView`). Toolbar buttons "Explain" / "Explain analyze" (analyze hidden for SQLite) + palette commands.
- **History**: on a successful `query`-tab run, call `queries.historyAdd(activeProfileId, sql)`. A "Query history" palette command / toolbar opens a `QueryPickerDialog` listing recent entries (sql preview + relative time); selecting loads the SQL into the active editor (or a new tab).
- **Saved**: "Save query" opens an inline name input (NOT `window.prompt` — Electron lacks it) → `queries.save`. "Open saved query" opens the same `QueryPickerDialog` in saved mode (load / delete). Palette commands for both.

The command palette (`App.tsx` `commands` array) gains: Format SQL, Explain, Explain analyze, Query history, Save query, Open saved query.

## Data flow (save + reopen a query)

1. User types SQL, runs "Save query" → inline name input → `window.fordb.queries.save(profileId, name, sql)` → persisted.
2. Later, "Open saved query" → `savedList(profileId)` → dialog → pick → `setSql(activeTab, saved.sql)` (or open a new tab with it).

## Error handling

- Store read/write failures surface as a toast/banner in the picker; a corrupt/missing file reads as empty (ENOENT/parse → `{}`), never throwing to the renderer.
- `buildExplain` on empty SQL → the explain tab shows the engine error (same path as a normal bad query).
- No active connection/profile → history/saved commands are no-ops (guarded), consistent with other connection-scoped commands.

## Security

- No secrets in the library file (SQL text only). Same trust boundary as profiles-minus-secrets. Secrets never reach the renderer (unchanged).
- SQL sent to `buildExplain`/format is the user's own; no injection surface (it's their statement, run as-is under their connection).

## Testing

- **Unit**: `buildExplain` (pg with/without analyze, sqlite query-plan, trailing-`;` trim); `QueryLibraryStore` (add/list/cap-200/dedup-consecutive; save/list/delete; per-profile isolation; ENOENT→empty) via a temp file.
- **Contract**: none new (no adapter capability added — EXPLAIN runs through existing `executeQuery`).
- **e2e** (headless SQLite): type SQL → Format (assert it reformatted) → Save with a name → clear editor → Open saved → assert SQL restored → Explain → assert a plan view renders.

## Exit criteria

From the palette: explain a query (plan view renders), re-run from history (a prior statement reloads), and save + reopen a named query — plus format the current SQL. Per-connection history and saved queries persist across app restarts.

## Task decomposition (for the plan)

1. `sql-formatter` dep + `useDialect` hook + Format action/button/command.
2. `buildExplain` (pure + unit) + `'explain'` tab kind + `ExplainView` + Explain/Explain-analyze buttons/commands.
3. `QueryLibraryStore` (main) + unit tests.
4. IPC + preload `window.fordb.queries` + typing.
5. Renderer: record history on run; `QueryPickerDialog` + Save (inline name) / Open-saved / History pickers + palette commands.
6. Editor theming — CodeMirror light/dark theme extension driven by the app theme.
7. e2e (format → save → reopen → explain).

# fordb MA4 — Query Power Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Format SQL, EXPLAIN with a plan view, persistent per-connection query history, named saved queries — all from the palette + query toolbar — plus theme-aware editor.

**Architecture:** A new `QueryLibraryStore` (main, one JSON file) holds history + saved queries, exposed as `window.fordb.queries`. Pure `buildExplain` builds the engine's plan statement; EXPLAIN runs through the existing `executeQuery` into a new `'explain'` tab. Formatting uses `sql-formatter` in the renderer. Editor theming drives CodeMirror from the app theme.

**Tech Stack:** TypeScript strict, Electron IPC, React 19, Zustand, CodeMirror 6, `sql-formatter`, vitest, Playwright.

## Global Constraints

- pnpm; Node >= 22; TypeScript strict; no `any` except typed IPC-boundary casts.
- No secrets in the library file (SQL text only); secrets stay in main/keychain, never reach the renderer.
- Electron has **no `window.prompt`** — name entry uses inline inputs.
- History capped at 200 newest per profile; dedup when new SQL equals the most-recent entry.
- `@shared/*` alias. Renderer-importing tests → `tsconfig.web`; pure/main tests → `tsconfig.node`.
- Each task ends `pnpm typecheck && pnpm lint && pnpm test` (+ `pnpm build` for renderer/main tasks). One PR per task against `main`.

## File Structure (end state)

```
package.json                                   # MODIFY: + sql-formatter
src/shared/sql/explain.ts                      # NEW: buildExplain (pure)
src/main/query-library-store.ts                # NEW: QueryLibraryStore
src/main/ipc.ts                                # MODIFY: queries:* handlers
src/main/index.ts                              # MODIFY: construct the store
src/preload/index.ts                           # MODIFY: window.fordb.queries bridge
src/renderer/src/rpc.ts                        # MODIFY: fordb.queries typing
src/renderer/src/query/use-dialect.ts          # NEW: useDialect() hook
src/renderer/src/query/cm-theme.ts             # MODIFY: light/dark theme-aware
src/renderer/src/components/SqlEditor.tsx      # MODIFY: theme compartment
src/renderer/src/store-query.ts                # MODIFY: 'explain' tab, openExplain, formatActive, history record
src/renderer/src/components/ExplainView.tsx    # NEW: plan view
src/renderer/src/components/QueryPickerDialog.tsx # NEW: history/saved picker
src/renderer/src/components/QueryWorkbench.tsx  # MODIFY: toolbar buttons + render ExplainView
src/renderer/src/App.tsx                        # MODIFY: palette commands + picker wiring
tests/unit/explain.test.ts                     # NEW
tests/unit/query-library-store.test.ts         # NEW
tests/e2e/query-tools.spec.ts                  # NEW
```

---

### Task 1: sql-formatter + useDialect + Format

**Files:**

- Modify: `package.json`, `src/renderer/src/store-query.ts`, `src/renderer/src/components/QueryWorkbench.tsx`, `src/renderer/src/App.tsx`
- Create: `src/renderer/src/query/use-dialect.ts`

**Interfaces:**

- Produces: `useDialect(): { dialect: 'pg' | 'sqlite'; sqlLang: 'postgresql' | 'sqlite' }`; `formatActive()` store action; "Format SQL" toolbar button + palette command.

- [ ] **Step 1: Add the dependency**

Run: `pnpm add sql-formatter`. Verify it appears under `dependencies` in `package.json`.

- [ ] **Step 2: useDialect hook**

`src/renderer/src/query/use-dialect.ts`:

```ts
import { useConnStore } from '../store'
import { useProfiles } from './profiles'

export function useDialect(): { dialect: 'pg' | 'sqlite'; sqlLang: 'postgresql' | 'sqlite' } {
  const profileId = useConnStore((s) => s.activeProfileId)
  const { data: profiles = [] } = useProfiles()
  const pg = profiles.find((p) => p.id === profileId)?.engine === 'postgres'
  return { dialect: pg ? 'pg' : 'sqlite', sqlLang: pg ? 'postgresql' : 'sqlite' }
}
```

- [ ] **Step 3: formatActive store action**

In `src/renderer/src/store-query.ts` add to `QueryState` and implement:

```ts
  formatActive: (sqlLang: 'postgresql' | 'sqlite') => void
```

```ts
  formatActive: (sqlLang) => {
    const s = get()
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    if (!tab || tab.kind !== 'query' || !tab.sql.trim()) return
    // Lazy import keeps sql-formatter out of the initial bundle path.
    void import('sql-formatter').then(({ format }) => {
      try {
        get().setSql(tab.id, format(tab.sql, { language: sqlLang }))
      } catch {
        // A formatter parse error leaves the SQL untouched (best-effort prettify).
      }
    })
  },
```

- [ ] **Step 4: Toolbar button + palette command**

In `QueryWorkbench.tsx` (query-tab toolbar) add a "Format" button calling `useQueryStore.getState().formatActive(sqlLang)` (sqlLang from `useDialect()`). In `App.tsx` `commands` add `{ id: 'format-sql', label: 'Format SQL', run: () => useQueryStore.getState().formatActive(dialectLang) }` (compute `dialectLang` from `useDialect()` in App).

- [ ] **Step 5: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

```bash
git add package.json pnpm-lock.yaml src/renderer/src/query/use-dialect.ts src/renderer/src/store-query.ts src/renderer/src/components/QueryWorkbench.tsx src/renderer/src/App.tsx
git commit -m "feat: SQL format (sql-formatter) + useDialect hook"
```

---

### Task 2: buildExplain + explain tab + ExplainView

**Files:**

- Create: `src/shared/sql/explain.ts`, `tests/unit/explain.test.ts`, `src/renderer/src/components/ExplainView.tsx`
- Modify: `src/renderer/src/store-query.ts`, `src/renderer/src/components/QueryWorkbench.tsx`, `src/renderer/src/App.tsx`

**Interfaces:**

- Produces: `buildExplain(sql, dialect, analyze): string`; `QueryTab.kind` gains `'explain'`; `openExplain(analyze)` store action; `ExplainView`.

- [ ] **Step 1: Failing test**

`tests/unit/explain.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildExplain } from '../../src/shared/sql/explain'

describe('buildExplain', () => {
  it('pg: EXPLAIN / EXPLAIN ANALYZE, trailing ; trimmed', () => {
    expect(buildExplain('SELECT 1;', 'pg', false)).toBe('EXPLAIN SELECT 1')
    expect(buildExplain('SELECT 1', 'pg', true)).toBe('EXPLAIN ANALYZE SELECT 1')
  })
  it('sqlite: EXPLAIN QUERY PLAN, analyze ignored', () => {
    expect(buildExplain('SELECT 1', 'sqlite', true)).toBe('EXPLAIN QUERY PLAN SELECT 1')
  })
})
```

- [ ] **Step 2: Run → FAIL**, then implement.

`src/shared/sql/explain.ts`:

```ts
export function buildExplain(sql: string, dialect: 'pg' | 'sqlite', analyze: boolean): string {
  const body = sql.trim().replace(/;\s*$/, '')
  if (dialect === 'sqlite') return `EXPLAIN QUERY PLAN ${body}`
  return `EXPLAIN ${analyze ? 'ANALYZE ' : ''}${body}`
}
```

- [ ] **Step 3: explain tab + openExplain**

In `store-query.ts`: `QueryTab.kind` becomes `'query' | 'data' | 'structure' | 'explain'`. Add `openExplain: (sqlLang, dialect, analyze) => Promise<void>` — actually the dialect suffices; signature `openExplain: (dialect: 'pg' | 'sqlite', analyze: boolean) => Promise<void>`:

```ts
  openExplain: async (dialect, analyze) => {
    const src = get().tabs.find((t) => t.id === get().activeTabId)
    if (!src || !src.sql.trim()) return
    const id = tabId()
    const tab: QueryTab = {
      id,
      sql: buildExplain(src.sql, dialect, analyze),
      status: 'idle',
      kind: 'explain'
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
    await get().run(id)
  },
```

Import `buildExplain`. In `run()`, an `'explain'` tab must go through the buffered `executeQuery` path (not openBrowse/openQuery streaming) so the plan rows are available at once — add a branch: if `tab.kind === 'explain'`, `const r = await api.executeQuery(connId, tab.sql)`, store the rows on the tab (add `explainRows?: string[]` to QueryTab: map each row to its joined columns), set status done. Keep it minimal:

```ts
if (tab.kind === 'explain') {
  const r = await api.executeQuery(connId, tab.sql)
  set((s) => ({
    tabs: patch(s.tabs, id, {
      status: 'done',
      explainRows: r.rows.map((row) => row.map((c) => (c == null ? '' : String(c))).join('  ')),
      elapsedMs: performance.now() - started
    })
  }))
  return
}
```

Add `explainRows?: string[]` to `QueryTab`.

- [ ] **Step 4: ExplainView + wiring**

`src/renderer/src/components/ExplainView.tsx` renders `tab.explainRows` in a monospace `<pre>` (one row per line), with the explain SQL shown above. In `QueryWorkbench.tsx`: render `<ExplainView tab={tab} />` when `tab.kind === 'explain'`; add "Explain" and "Explain analyze" toolbar buttons (analyze hidden when `dialect === 'sqlite'`) calling `openExplain(dialect, analyze)`. Add palette commands in `App.tsx`.

- [ ] **Step 5: Verify + commit**

Run: `pnpm vitest run tests/unit/explain.test.ts`, then `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

```bash
git add src/shared/sql/explain.ts tests/unit/explain.test.ts src/renderer/src/components/ExplainView.tsx src/renderer/src/store-query.ts src/renderer/src/components/QueryWorkbench.tsx src/renderer/src/App.tsx
git commit -m "feat: EXPLAIN/EXPLAIN ANALYZE plan view + buildExplain"
```

---

### Task 3: QueryLibraryStore (main) + unit tests

**Files:**

- Create: `src/main/query-library-store.ts`, `tests/unit/query-library-store.test.ts`

**Interfaces:**

- Produces: `QueryLibraryStore` with `addHistory`/`listHistory`/`saveQuery`/`listSaved`/`deleteSaved`; types `HistoryEntry`, `SavedQuery`.

- [ ] **Step 1: Failing tests**

`tests/unit/query-library-store.test.ts` — use a temp file:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QueryLibraryStore } from '../../src/main/query-library-store'

let store: QueryLibraryStore
beforeEach(() => {
  store = new QueryLibraryStore(join(mkdtempSync(join(tmpdir(), 'fordb-ql-')), 'q.json'))
})

describe('QueryLibraryStore', () => {
  it('history: prepend newest-first, dedup consecutive, cap 200, per-profile', async () => {
    await store.addHistory('p1', 'A')
    await store.addHistory('p1', 'A') // dedup consecutive
    await store.addHistory('p1', 'B')
    await store.addHistory('p2', 'Z')
    expect((await store.listHistory('p1')).map((h) => h.sql)).toEqual(['B', 'A'])
    expect((await store.listHistory('p2')).map((h) => h.sql)).toEqual(['Z'])
    for (let i = 0; i < 250; i++) await store.addHistory('p3', `q${i}`)
    expect(await store.listHistory('p3')).toHaveLength(200)
  })
  it('saved: save/list/delete, per-profile, stable ids', async () => {
    const a = await store.saveQuery('p1', 'first', 'SELECT 1')
    const b = await store.saveQuery('p1', 'second', 'SELECT 2')
    expect((await store.listSaved('p1')).map((s) => s.name)).toEqual(['first', 'second'])
    await store.deleteSaved('p1', a.id)
    expect((await store.listSaved('p1')).map((s) => s.id)).toEqual([b.id])
    expect(await store.listSaved('p2')).toEqual([])
  })
  it('missing file reads as empty', async () => {
    expect(await store.listHistory('nope')).toEqual([])
    expect(await store.listSaved('nope')).toEqual([])
  })
})
```

- [ ] **Step 2: Run → FAIL**, then implement.

`src/main/query-library-store.ts`:

```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface HistoryEntry {
  sql: string
  ts: number
}
export interface SavedQuery {
  id: string
  name: string
  sql: string
  createdAt: number
}
interface LibraryFile {
  history?: Record<string, HistoryEntry[]>
  saved?: Record<string, SavedQuery[]>
  counter?: number
}

const HISTORY_CAP = 200

export class QueryLibraryStore {
  constructor(private readonly filePath: string) {}

  private async read(): Promise<LibraryFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as LibraryFile
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw err
    }
  }
  private async write(data: LibraryFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }

  async addHistory(profileId: string, sql: string): Promise<void> {
    const data = await this.read()
    const list = data.history?.[profileId] ?? []
    if (list[0]?.sql === sql) return // dedup consecutive
    const next = [{ sql, ts: Date.now() }, ...list].slice(0, HISTORY_CAP)
    data.history = { ...data.history, [profileId]: next }
    await this.write(data)
  }
  async listHistory(profileId: string): Promise<HistoryEntry[]> {
    return (await this.read()).history?.[profileId] ?? []
  }
  async saveQuery(profileId: string, name: string, sql: string): Promise<SavedQuery> {
    const data = await this.read()
    const counter = (data.counter ?? 0) + 1
    const q: SavedQuery = { id: `s${counter}`, name, sql, createdAt: Date.now() }
    data.counter = counter
    data.saved = { ...data.saved, [profileId]: [...(data.saved?.[profileId] ?? []), q] }
    await this.write(data)
    return q
  }
  async listSaved(profileId: string): Promise<SavedQuery[]> {
    return (await this.read()).saved?.[profileId] ?? []
  }
  async deleteSaved(profileId: string, id: string): Promise<void> {
    const data = await this.read()
    if (!data.saved?.[profileId]) return
    data.saved[profileId] = data.saved[profileId].filter((q) => q.id !== id)
    await this.write(data)
  }
}
```

- [ ] **Step 3: Run → PASS + commit**

Run: `pnpm vitest run tests/unit/query-library-store.test.ts`, `pnpm typecheck && pnpm lint`.

```bash
git add src/main/query-library-store.ts tests/unit/query-library-store.test.ts
git commit -m "feat: QueryLibraryStore (per-profile history + saved queries)"
```

---

### Task 4: IPC + preload `window.fordb.queries`

**Files:**

- Modify: `src/main/index.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/rpc.ts`

**Interfaces:**

- Produces: `window.fordb.queries.{historyList,historyAdd,savedList,save,deleteSaved}`.

- [ ] **Step 1: Construct the store**

In `src/main/index.ts`, alongside the other stores: `const queryLibrary = new QueryLibraryStore(join(app.getPath('userData'), 'query-library.json'))` and pass it into the ipc registrar (follow how `profiles`/`settings` are threaded — match the existing wiring exactly).

- [ ] **Step 2: IPC handlers**

In `src/main/ipc.ts` add (mirroring `profiles:*`):

```ts
ipcMain.handle('queries:history-list', (_e, profileId: string) =>
  queryLibrary.listHistory(profileId)
)
ipcMain.handle('queries:history-add', (_e, profileId: string, sql: string) =>
  queryLibrary.addHistory(profileId, sql)
)
ipcMain.handle('queries:saved-list', (_e, profileId: string) => queryLibrary.listSaved(profileId))
ipcMain.handle('queries:save', (_e, profileId: string, name: string, sql: string) =>
  queryLibrary.saveQuery(profileId, name, sql)
)
ipcMain.handle('queries:saved-delete', (_e, profileId: string, id: string) =>
  queryLibrary.deleteSaved(profileId, id)
)
```

- [ ] **Step 3: preload bridge**

In `src/preload/index.ts` add to the `fordb` object:

```ts
  queries: {
    historyList: (profileId: string) => ipcRenderer.invoke('queries:history-list', profileId),
    historyAdd: (profileId: string, sql: string) => ipcRenderer.invoke('queries:history-add', profileId, sql),
    savedList: (profileId: string) => ipcRenderer.invoke('queries:saved-list', profileId),
    save: (profileId: string, name: string, sql: string) => ipcRenderer.invoke('queries:save', profileId, name, sql),
    deleteSaved: (profileId: string, id: string) => ipcRenderer.invoke('queries:saved-delete', profileId, id)
  },
```

- [ ] **Step 4: renderer typing**

In `src/renderer/src/rpc.ts`, extend the `Window['fordb']` interface with the `queries` shape above (return types `Promise<HistoryEntry[]>` / `Promise<SavedQuery[]>` / `Promise<void>` / `Promise<SavedQuery>`; import the types from `@main/query-library-store` or redeclare a shared type — prefer a small shared type file if `@main` isn't importable from the renderer tsconfig; check the existing `profiles` typing approach and match it).

- [ ] **Step 5: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

```bash
git add src/main/index.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/rpc.ts
git commit -m "feat: window.fordb.queries IPC surface for history + saved queries"
```

---

### Task 5: Renderer — history recording + pickers + Save/Open + palette

**Files:**

- Modify: `src/renderer/src/store-query.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/QueryWorkbench.tsx`
- Create: `src/renderer/src/components/QueryPickerDialog.tsx`

**Interfaces:**

- Consumes: `window.fordb.queries`, `activeProfileId`, `setSql`/`newTab`.

**Acceptance (implement with existing dialog/list primitives; keep this behavior):**

- **Record history:** in `run()`, after a `query`-tab run reaches `status: 'done'`, fire-and-forget `window.fordb.queries.historyAdd(profileId, tab.sql)` (profileId from `useConnStore.getState().activeProfileId`; skip if null). Only for `kind === 'query'`.
- **QueryPickerDialog** — a modal listing entries (`{title, items: {label, sublabel?, sql, id?}[]}`), each row selectable → `onPick(sql)`; saved mode also shows a per-row delete. Filter input at top.
- **Save query:** a toolbar button / palette command opens an **inline name input** (not `window.prompt`); on submit → `queries.save(profileId, name, activeSql)`.
- **Open saved / Query history:** palette commands + toolbar buttons open `QueryPickerDialog` populated from `savedList` / `historyList`; picking loads the SQL into the active `query` tab via `setSql` (or a new tab if the active tab isn't a query tab).
- Guard all on an active connection + profile.

- [ ] **Step 1: Implement recording + dialog + commands**

Build per acceptance. Add the six palette commands (Format SQL and the two Explain commands from Tasks 1–2 already exist; add Save query, Open saved query, Query history). Wire toolbar buttons in the query-tab toolbar.

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Report the dialog primitive used.

```bash
git add src/renderer/src/store-query.ts src/renderer/src/App.tsx src/renderer/src/components/QueryWorkbench.tsx src/renderer/src/components/QueryPickerDialog.tsx
git commit -m "feat: query history recording + save/open pickers + palette commands"
```

---

### Task 6: Editor theming (CodeMirror light/dark)

**Files:**

- Modify: `src/renderer/src/query/cm-theme.ts`, `src/renderer/src/components/SqlEditor.tsx`

**Interfaces:**

- Consumes: the app theme signal (`window.fordb.appearance.onThemeChanged` + `initialTheme`), a CodeMirror `Compartment`.

**Acceptance:**

- `cm-theme.ts` exports a light and a dark theme (`EditorView.theme(..., { dark })` + a syntax highlight style for each) — or one theme parameterized by `'light' | 'dark'`. Colors track the app's Tailwind palette (background/foreground/selection/gutter/cursor) reasonably.
- `SqlEditor.tsx` holds the theme in a `Compartment` so a theme change **reconfigures** the editor (via `view.dispatch({ effects: themeCompartment.reconfigure(themeFor(mode)) })`) WITHOUT destroying the doc/selection. Subscribe to `window.fordb.appearance.onThemeChanged` (and read `initialTheme`) to drive it; unsubscribe on unmount if the API supports it (otherwise guard against a destroyed view).
- The editor must still recreate on `connectionId` change (existing behavior) — the theme compartment is independent of that.

- [ ] **Step 1: Implement the theme compartment**

Make `cm-theme` theme-aware; add the compartment + subscription in `SqlEditor`. Resolve the current resolved light/dark (the `appearance` API exposes `initialTheme: 'light' | 'dark'` and `onThemeChanged(cb)`).

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Report how the theme signal is wired.

```bash
git add src/renderer/src/query/cm-theme.ts src/renderer/src/components/SqlEditor.tsx
git commit -m "feat: theme-aware CodeMirror editor (light/dark via compartment)"
```

---

### Task 7: e2e — format → save → reopen → explain (headless SQLite)

**Files:**

- Create: `tests/e2e/query-tools.spec.ts`

- [ ] **Step 1: e2e**

`tests/e2e/query-tools.spec.ts` — connect SQLite, in a query tab: type `select 1`, click **Format** (assert the editor text became `SELECT 1` uppercased/reformatted — read `.cm-content` text), **Save query** with a name via the inline input, clear the editor, **Open saved query** → pick it → assert the SQL is restored, then **Explain** → assert the plan view renders (a `QUERY PLAN`/`SCAN` marker or the ExplainView container). Fresh `--user-data-dir`; auto-accept any confirm dialog. Model connect steps on `tests/e2e/structure.spec.ts` and target the toolbar buttons / palette by their labels.

- [ ] **Step 2: Run + commit**

Run: `pnpm build && pnpm e2e tests/e2e/query-tools.spec.ts` (retry once on a cold-start flake).

```bash
git add tests/e2e/query-tools.spec.ts
git commit -m "test: query-tools e2e (format/save/reopen/explain, headless SQLite)"
```

---

## Self-Review (done at plan time)

1. **Spec coverage:** Format (spec §Format) → Task 1; EXPLAIN (§EXPLAIN) → Task 2; persistence (§Persistence) → Task 3 + 4; history/saved UI (§Renderer) → Task 5; editor theming (§Editor theming) → Task 6; testing (§Testing): unit (2,3), e2e (7).
2. **Placeholder scan:** Full code in Tasks 1–4. Tasks 5–7 acceptance-defined (dialog/toolbar/theme wiring follow existing primitives) with every consumed contract (`window.fordb.queries`, `buildExplain`, `formatActive`, `openExplain`, the `appearance` signal) fully specified.
3. **Type consistency:** `useDialect` (1) consumed by 1/2/5; `buildExplain(sql, dialect, analyze)` (2) consumed by store `openExplain`; `HistoryEntry`/`SavedQuery` (3) flow through IPC (4) to the renderer typing (4) and pickers (5); `QueryTab.kind` gains `'explain'` (2) + `explainRows` consumed by `ExplainView` (2). No `window.prompt` anywhere (inline inputs, per constraint).

**Known deliberate deferrals:** graphical EXPLAIN visualization, history full-text search, saved-query export/params, user-selectable editor themes (only app-light/dark in v1).

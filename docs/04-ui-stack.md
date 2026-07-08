# 04 — UI Stack

Question: grid for large result sets, SQL editor, schema tree, UI framework, Mongo document viewer — leanest viable combination (2025–2026 state).

## Result grid (100k+ rows)

| Library | gzip | Virtualization | Editing | License | Bindings |
|---|---|---|---|---|---|
| Glide Data Grid v6 | 63.8 KB | Canvas, rows+cols, "millions of rows" | Built in | MIT | React only |
| AG Grid Community v36 | 338 KB | Row+col DOM | Yes | MIT | React/Vue/Angular/vanilla |
| TanStack Table + Virtual | ~22 KB | DIY wiring | DIY (headless) | MIT | React/Vue/Svelte/Solid/vanilla |
| RevoGrid v4 | 56.3 KB | Both axes | Excel-like | MIT core (Pro plugins paid) | Web Component, any framework |
| Handsontable v18 | 286 KB | Yes | Excellent | **Non-commercial only free** — disqualified | React/Vue/Angular |
| Tabulator v6.5 | 102 KB | Virtual DOM rows | Yes | MIT | Vanilla, framework-agnostic |

- Glide Data Grid: performance standout (canvas rendering — "once you need to load/unload hundreds of DOM elements per frame nothing can save you"), but **maintenance stalled** — last release Feb 2024. Budget for pinning/forking. ([repo](https://github.com/glideapps/glide-data-grid))
- Precedent verified: **Beekeeper Studio uses Tabulator** (`tabulator-tables ^6.5.2` + own MIT fork), with an open issue to replace Tabulator's editors — sign its editing model chafes at scale. ([package.json](https://raw.githubusercontent.com/beekeeper-studio/beekeeper-studio/master/apps/studio/package.json), [issue #2713](https://github.com/beekeeper-studio/beekeeper-studio/issues/2713))

**Pick: Glide Data Grid** (best 100k+ row feel per KB, editing included), TanStack Table+Virtual as fallback if maintenance stall worries us.

## SQL editor — CodeMirror 6 over Monaco

- Monaco real-world shipped weight: **2.4 MB download even after optimization** (40% of all JS on Sourcegraph's search page); npm package ~69 MB unpacked. No official mobile/touch support. Built-in SQL is tokenization only — completion is DIY. ([Sourcegraph migration](https://sourcegraph.com/blog/migrating-monaco-codemirror))
- CodeMirror 6: **~119 KB gzip** for full basic setup, tree-shakeable, touch-capable. `@codemirror/lang-sql` ships PostgreSQL/SQLite/MySQL/MSSQL/Cassandra/PLSQL dialects + **schema-aware completion** (`schema`, `defaultTable`, `schemaCompletionSource()` — completes schema → table → column). Known gap: alias-aware completion needs extra work. ([lang-sql](https://www.npmjs.com/package/@codemirror/lang-sql), [Bundlephobia](https://bundlephobia.com/package/codemirror))
- Sourcegraph replaced 90% of Monaco functionality in a 2-day PoC; Replit made the same move. Beekeeper uses CodeMirror (v5).

**Pick: CodeMirror 6 + @codemirror/lang-sql.** ~10–20x lighter than Monaco. Note: lang-sql repo moved to https://code.haverbeke.berlin/codemirror/lang-sql (GitHub archived); still maintained, v6.10.0 Apr 2026.

## Schema tree (thousands of nodes)

- **react-arborist** (31.4 KB gzip): virtualized, drag-drop, inline rename, multi-select, keyboard nav — batteries included. ([repo](https://github.com/brimdata/react-arborist))
- **headless-tree** (successor to react-complex-tree, v1.7.0 May 2026): headless, composes with TanStack Virtual — pick if we want one virtualization engine for grid+tree. ([repo](https://github.com/lukasbach/headless-tree))
- No dominant Vue/Svelte virtualized tree — flatten-visible-nodes + TanStack Virtual is the pattern (Beekeeper uses vue-virtual-scroll-list).

**Pick: react-arborist** for speed-to-ship.

## UI framework — React

Verified usage: Beekeeper = Vue **2.7 (EOL — legacy drag, not endorsement)**; Sqlectron = React; Antares = Vue; recent Tauri clients (rsql, postbird-tauri) skew React/Preact.

Deciding factor is **component gravity**: the two best-in-class picks for this exact app (Glide Data Grid, react-arborist/headless-tree) are React-only. Vue/Svelte force RevoGrid/Tabulator + hand-rolled tree.

**Pick: React + TypeScript.**

## MongoDB document viewer

- Tree: **@uiw/react-json-view** v2 — 8.8 KB gzip, zero-dep, themeable (v2 tagged alpha — pin version).
- Raw: reuse the CodeMirror 6 instance with `@codemirror/lang-json` — near-zero marginal cost.
- vanilla-jsoneditor (291 KB gzip, embeds own CodeMirror) only if full Compass-like edit/query/transform needed later.

## Lean stack summary

| Slot | Pick | gzip |
|---|---|---|
| Framework | React + TypeScript | — |
| Grid | Glide Data Grid | ~64 KB |
| SQL editor | CodeMirror 6 + lang-sql | ~120 KB |
| Schema tree | react-arborist | ~31 KB |
| Mongo docs | @uiw/react-json-view + CM6 JSON | ~9 KB |

**Total ~250 KB gzip** vs 3 MB+ for AG Grid + Monaco + jsoneditor. Leanness won at the component layer, as planned in doc 01.

Full source list: see research agent report (Bundlephobia entries per package, Sourcegraph/Replit writeups, Beekeeper package.json, Monaco issues #1504/#4622).

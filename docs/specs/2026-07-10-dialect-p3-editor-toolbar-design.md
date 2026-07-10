# Dialect Reskin — Phase 3: Editor + Toolbar + Query Bar (Design)

**Status:** approved (theme-tracking editor panel), ready for plan
**Date:** 2026-07-10
**Milestone:** Dialect Reskin P3 (of 6). P1 shell+tokens, P2 sidebar+connections shipped.

## Goal

Give the query workbench the Dialect chrome: a Dialect tab strip + toolbar (icons, primary Run with a platform-correct ⌘⏎/Ctrl⏎ badge), a "Query editor" panel header grouping Format/History/Run, and a compact query bar on data tabs showing the generated browse SQL. **Visual/chrome only — no tab-model, store, or behavior changes.** The editor panel follows the app theme (user decision; the mockup's always-dark panel was declined).

## Binding constraints

- **e2e text contracts preserved verbatim:** `Run` (exact), `Cancel`, `Format`, `Explain`, `Explain analyze`, `Save`, `Saved`, `History`, `Export CSV`, `Export JSON`, `.cm-content`, the `N rows` result text, tab labels. Restyle around them; never rename.
- Existing handlers/stores untouched. `Mod-Enter` run binding already exists (SqlEditor.tsx:42) — the ⌘⏎ badge documents it, nothing new to wire.
- Document-mode (Mongo) workbench keeps its own layout; only shared chrome classes apply.
- TS strict; typecheck/lint/test/build + SQLite e2e (workers=1) green per task; PG specs remain pre-existing keychain reds.

## Design

1. **Tab strip (QueryWorkbench):** Dialect pills — active `bg-surface-2 text-foreground border-border` rounded-t, inactive `text-muted-foreground hover:bg-surface-2/60`; the `+` and `×` affordances keep their texts/handlers; strip sits on `bg-surface-1 border-b border-border`.
2. **Toolbar:** buttons get lucide icons (Run=play, Cancel=x, Format=align-left, Explain=search, Save=save, Saved=bookmark, History=clock, Export=download) + Dialect ghost styling (`text-muted-foreground hover:bg-surface-2 border border-transparent hover:border-border`, 12px). **Run** becomes the primary action: `bg-primary text-primary-foreground hover:bg-primary-hover` with a trailing keycap badge `⌘⏎` (darwin) / `Ctrl ⏎` (else) at 10px opacity-70. Cancel keeps destructive hover.
3. **Query editor panel header:** an 11px uppercase `Query editor` label row (`text-muted-foreground`, `bg-surface-1`, hairline top/bottom) above the CodeMirror area; Format/History/Run visually group right of it (same buttons — moved markup, same handlers/texts). Results header row (`Results` + row count + Copy/Export) gets the same treatment where it already exists.
4. **Compact query bar (data tabs, TableDataGrid):** a one-line bar under the data toolbar — language chip (`SQL`, `bg-primary/10 text-primary` 10px uppercase) + the generated browse SQL one-liner (`buildBrowseSql(opts, dialect)` — pure, already shared; truncated, `font-mono text-xs text-muted-foreground`) + the existing refresh/run affordance right-aligned. Read-only; documents what the grid is showing (mockup's `showCompactBar`).

## Tasks

1. **T1 — tab strip + toolbar chrome** (QueryWorkbench.tsx only).
2. **T2 — query-editor panel header + results header** (QueryWorkbench.tsx).
3. **T3 — compact query bar on data tabs** (TableDataGrid.tsx + buildBrowseSql import).

## Testing

Unit suite must stay green (no logic changes ⇒ no new units except: if the keycap/badge or query-line builder becomes a small pure helper, one test). SQLite e2e 8/8 per task. Manual smoke: icons render, Run badge per platform, compact bar shows real SQL for an active browse tab.

## Out of scope

Results grid cells/structure view (P4), Mongo document views (P5), palette/overlays (P6), always-dark editor panel (declined), tab-model changes, Add-row/Filter/Sort toolbar relocations (the mockup's data-toolbar composition lands with P4's grid work).

## Self-review

Placeholders: none. Consistency: only class/markup changes; every e2e text enumerated and preserved; buildBrowseSql consumed read-only. Scope: three files.

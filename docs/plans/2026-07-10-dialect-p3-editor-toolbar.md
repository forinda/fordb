# Dialect Reskin — Phase 3 (Editor + Toolbar + Query Bar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dialect chrome for the query workbench — tab pills, icon toolbar with a primary Run (+platform keycap), a Query-editor panel header, and a compact browse-SQL bar on data tabs. Visual only.

**Architecture:** Class/markup changes inside `QueryWorkbench.tsx` and `TableDataGrid.tsx`; zero store/handler changes. The compact bar renders `buildBrowseSql` (existing pure shared helper) read-only.

**Tech Stack:** React 19 + Tailwind v4 Dialect tokens, `~icons/lucide/*`, existing CodeMirror setup (Mod-Enter already bound).

**Spec:** `docs/specs/2026-07-10-dialect-p3-editor-toolbar-design.md`

## Global Constraints

- **Preserve verbatim** (e2e + muscle memory): button texts `Run`, `Cancel`, `Format`, `Explain`, `Explain analyze`, `Save`, `Saved`, `History`, `Export CSV`, `Export JSON`; `.cm-content`; the `N rows` result text; tab labels/`+`/`×` handlers.
- No behavior/store changes. Keycap badge: `⌘⏎` on darwin, `Ctrl ⏎` otherwise (via `window.fordb.platform`).
- Verify per task: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` + `pnpm e2e` (SQLite 8/8; PG = pre-existing keychain reds). Prettier on touched files; commit trailers as usual; per-task PR against `main`.

### Task 1: Tab strip + toolbar chrome (`QueryWorkbench.tsx`)

Acceptance: tab pills (active `bg-surface-2 text-foreground` on `bg-surface-1` strip, rounded-t, hairline border-b strip); toolbar buttons get lucide icons + ghost styling (`text-muted-foreground hover:bg-surface-2 hover:border-border border border-transparent rounded px-2 py-0.5 text-xs`); **Run** primary (`bg-primary text-primary-foreground hover:bg-primary-hover`) with the platform keycap badge; Cancel destructive hover. Icons: play/x/align-left/search/save/bookmark/clock/download. All texts/handlers unchanged.

### Task 2: Query-editor panel header + results header (`QueryWorkbench.tsx`)

Acceptance: an 11px uppercase `Query editor` row (`bg-surface-1 text-muted-foreground`, hairline borders) directly above the editor area, with Format/History/Run grouped at its right (same buttons — markup moves, handlers/texts identical; the remaining buttons stay on the main toolbar). A matching `Results` header above the grid where the row-count/export line already renders. Document-mode tabs unaffected.

### Task 3: Compact browse-SQL bar (`TableDataGrid.tsx`)

Acceptance: one-line bar under the data-tab toolbar — `SQL` chip (`bg-primary/10 text-primary text-[10px] uppercase rounded px-1`), the `buildBrowseSql({schema, table, filters, sort, pageSize}, dialect)` first line truncated in `font-mono text-xs text-muted-foreground`, right-aligned existing refresh affordance. Read-only; renders only for browse/data tabs (guard on the tab's data state). Dialect from the existing `useDialect()`/tab context — read how TableDataGrid gets its dialect today and reuse.

**End of P3 — whole-phase review, fix Criticals/Importants, then P4.**

## Self-Review

Spec coverage: T1 strip+toolbar (§1–2), T2 panel headers (§3), T3 compact bar (§4). Placeholders: none — classes and icon names enumerated; helper signatures exist in-repo. Types: no new interfaces.

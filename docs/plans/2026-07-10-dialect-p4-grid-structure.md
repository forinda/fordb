# Dialect Reskin — Phase 4 (Results Grid + Structure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dialect theme for the Glide grid (light/dark tracking) + Dialect skin for the Structure view. Chrome-only.

**Spec:** `docs/specs/2026-07-10-dialect-p4-grid-structure-design.md`

## Global Constraints

Chrome-only (no behavior/store/Glide-prop changes beyond `theme`); e2e texts untouched; theme helper pure with a unit test; per-branch verify `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e` (SQLite 8/8; PG = pre-existing keychain reds); prettier + trailers.

### Task 1: `glide-theme.ts` + wire grids

Create `src/renderer/src/query/glide-theme.ts`:

```ts
export interface StyleGetter {
  (varName: string): string
}

/** Dialect theme for Glide DataEditor, derived from the live CSS tokens so it
 *  tracks light/dark. Pure given a style getter (unit-testable). */
export function dialectGlideTheme(
  get: StyleGetter
): Partial<import('@glideapps/glide-data-grid').Theme> {
  return {
    accentColor: get('--primary'),
    accentLight: `color-mix(in srgb, ${get('--primary')} 12%, transparent)`,
    textDark: get('--foreground'),
    textMedium: get('--muted-foreground'),
    textLight: get('--faint'),
    bgCell: get('--background'),
    bgHeader: get('--surface-1'),
    bgHeaderHovered: get('--surface-2'),
    bgHeaderHasFocus: get('--surface-2'),
    borderColor: get('--border-soft'),
    headerFontStyle: '600 11px',
    baseFontStyle: '12px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
  }
}

export function liveStyleGetter(): StyleGetter {
  const cs = getComputedStyle(document.documentElement)
  return (v) => cs.getPropertyValue(v).trim()
}
```

Unit (`tests/unit/glide-theme.test.ts`): with a fake getter (`(v) => ({'--primary':'#2563eb','--foreground':'#1a2740',...}[v])`), assert accentColor/textDark/bgHeader map to the right vars and font styles are set.

Wire: in `ResultsGrid.tsx` (and `TableDataGrid.tsx` if it renders its own `DataEditor` — check), compute `const theme = useMemo(() => dialectGlideTheme(liveStyleGetter()), [effective])` where `effective` comes from `useThemeStore` — pass `theme={theme}`.

### Task 2: StructureView Dialect skin

`Section` header → `text-[11px] font-medium uppercase tracking-wide text-muted-foreground` with hairline `border-border-soft`; column-table header cells → `text-[10px] uppercase font-mono text-faint`; each section's table wrapped `rounded-lg border border-border`; keep all texts/handlers.

**End of P4 — quick review, fixes, then P5.**

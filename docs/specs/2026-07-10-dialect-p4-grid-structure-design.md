# Dialect Reskin — Phase 4: Results Grid + Structure (Design)

**Status:** approved, ready for plan · **Date:** 2026-07-10 · **Milestone:** Dialect P4 (of 6)

## Goal

Bring the Glide results grid and the Structure view onto the Dialect visual system. Chrome-only; no data/store changes.

## Design

1. **Grid theme (`ResultsGrid.tsx`)** — Glide `DataEditor` gets a `theme` derived from the Dialect CSS tokens (accent `--primary`, ink `--foreground`/`--muted-foreground`, `bgCell` `--background`, `bgHeader` `--surface-1`, `borderColor` `--border-soft`, 13px base / 11px header font, `ui-monospace` for cells per the mockup's data grid). Theme must **track light/dark**: derive from `getComputedStyle(document.documentElement)` keyed on the theme store's `effective` value (re-derive on toggle). Row numbers already on (`rowMarkers="number"`).
2. **Structure view (`StructureView.tsx`)** — `Section` headers become Dialect 11px uppercase (`text-muted-foreground`, hairline), the table header row (`Column/Type/Nullable/Default/Key`) gets `text-[10px] uppercase mono text-faint` per the mockup, section spacing/cards per Dialect (`rounded-lg border border-border` around each table).
3. Same grid theme applies to `TableDataGrid`'s editor if it instantiates its own `DataEditor` (check; share the theme helper).

**Constraints:** e2e texts untouched (`Structure`, `Add column`, etc.); no Glide behavior props changed; theme helper pure + unit-testable (given a style-getter, returns the theme object).

## Tasks

T1 shared `glide-theme.ts` helper (+unit) + wire into ResultsGrid/TableDataGrid. T2 StructureView Dialect skin.

## Out of scope

Status-chip cell renderers (data-value styling), checkbox multi-select column, header type-sublabels inside the canvas (Glide single-line headers; the compact SQL bar + structure view carry type info), P5/P6 items (Mongo views, overlay, palette).

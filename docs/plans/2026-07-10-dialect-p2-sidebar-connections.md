# Dialect Reskin — Phase 2 (Sidebar + Connections Manager) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the connections landing with the Dialect connections manager (engine/favorites/environment rail + search + cards) backed by new `environment`/`favorite` profile metadata, and give the connected sidebar the Dialect skin.

**Architecture:** Metadata = two optional non-secret `BaseProfile` fields (persisted as-is). A pure `filterProfiles` helper drives the rail+search. `ConnectionManager` (full/slim variants) supersedes `ConnectionList`. Sidebar is a pure restyle — no tree-structure change.

**Tech Stack:** React 19 + Tailwind v4 Dialect tokens (P1), Zustand, TanStack Query, vitest, Playwright e2e (SQLite headless).

**Spec:** `docs/specs/2026-07-10-dialect-p2-sidebar-connections-design.md`

## Global Constraints

- TS strict, no `any`. Secrets untouched: metadata-only saves send empty `secretFields` → the existing `if (any secret)` guard skips `secrets.set` (keychain unclobbered) — verify in T1.
- **e2e compatibility:** 10+ specs click `getByText('+ New connection')` and connect by clicking the profile label text. The manager MUST keep a button with exact text `+ New connection` and cards whose label text is clickable-to-connect. Update selectors only where unavoidable; e2e stays green every task.
- Environment values exactly `'production' | 'staging' | 'local'`. Production badge = warning-styled; staging/local neutral.
- No SchemaTree structural change (ids/handlers/nodes identical).
- Per-task PR against `main`; `pnpm typecheck && pnpm lint && pnpm test && pnpm build` + `pnpm test:e2e` (or the repo's e2e script) green per task. Prettier on touched files. Commit trailers: Co-Authored-By + Claude-Session.

## File Structure

- `src/shared/adapter/types.ts` — MODIFY: `BaseProfile` + `environment?`/`favorite?`.
- `src/shared/profile-filter.ts` — CREATE: `ProfileFilter` + `filterProfiles`.
- `tests/unit/profile-filter.test.ts` — CREATE.
- `src/renderer/src/components/ProfileForm.tsx` — MODIFY: env select + favorite toggle.
- `src/renderer/src/components/ConnectionManager.tsx` — CREATE: rail + search + cards, `variant: 'full' | 'slim'`.
- `src/renderer/src/components/ConnectionList.tsx` — DELETE (T3, after both usages migrate).
- `src/renderer/src/App.tsx` — MODIFY: landing + switcher use ConnectionManager.
- `src/renderer/src/components/{ActiveConnectionBar,DatabaseSwitcher,SchemaTree}.tsx` — MODIFY (T4): Dialect classes only.
- `tests/e2e/*.spec.ts` — MODIFY only if a selector breaks.

---

### Task 1: Metadata + filterProfiles + form

**Files:** Modify `src/shared/adapter/types.ts`, `src/renderer/src/components/ProfileForm.tsx`. Create `src/shared/profile-filter.ts`, `tests/unit/profile-filter.test.ts`.

**Interfaces:** Produces `environment?: 'production' | 'staging' | 'local'`, `favorite?: boolean` on `BaseProfile`; `filterProfiles(profiles, filter)` with `ProfileFilter { engine?, environment?, favoritesOnly?, search? }`.

- [ ] **Step 1:** In `types.ts`, extend `BaseProfile`:

```ts
interface BaseProfile {
  id: string
  name: string
  /** Optional non-secret metadata (Dialect connections manager). */
  environment?: 'production' | 'staging' | 'local'
  favorite?: boolean
}
```

- [ ] **Step 2: Failing test** — `tests/unit/profile-filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { filterProfiles } from '../../src/shared/profile-filter'
import type { ConnectionProfile } from '../../src/shared/adapter/types'

const pg = (id: string, extra: object = {}): ConnectionProfile => ({
  id,
  name: `pg-${id}`,
  engine: 'postgres',
  host: 'db.acme.io',
  port: 5432,
  database: 'app',
  user: 'u',
  ...extra
})
const lite = (id: string, extra: object = {}): ConnectionProfile => ({
  id,
  name: `lite-${id}`,
  engine: 'sqlite',
  kind: 'local',
  file: `/tmp/${id}.db`,
  ...extra
})
const all = [
  pg('1', { environment: 'production', favorite: true }),
  pg('2', { environment: 'staging' }),
  lite('3', { favorite: true }),
  lite('4')
]

describe('filterProfiles', () => {
  it('empty filter returns all', () => {
    expect(filterProfiles(all, {})).toHaveLength(4)
  })
  it('narrows by engine', () => {
    expect(filterProfiles(all, { engine: 'sqlite' }).map((p) => p.id)).toEqual(['3', '4'])
  })
  it('narrows by environment', () => {
    expect(filterProfiles(all, { environment: 'production' }).map((p) => p.id)).toEqual(['1'])
  })
  it('narrows to favorites', () => {
    expect(filterProfiles(all, { favoritesOnly: true }).map((p) => p.id)).toEqual(['1', '3'])
  })
  it('search matches name and label, case-insensitive', () => {
    expect(filterProfiles(all, { search: 'PG-1' }).map((p) => p.id)).toEqual(['1'])
    expect(filterProfiles(all, { search: 'acme' }).length).toBeGreaterThan(0)
  })
  it('composes engine + favorites', () => {
    expect(
      filterProfiles(all, { engine: 'postgres', favoritesOnly: true }).map((p) => p.id)
    ).toEqual(['1'])
  })
})
```

- [ ] **Step 3:** Run `pnpm test -- profile-filter` → FAIL (module missing).
- [ ] **Step 4:** Implement `src/shared/profile-filter.ts`:

```ts
import type { ConnectionProfile } from './adapter/types'
import { connectionLabel } from './connection-label'

export interface ProfileFilter {
  engine?: ConnectionProfile['engine']
  environment?: 'production' | 'staging' | 'local'
  favoritesOnly?: boolean
  /** Case-insensitive match over name + connectionLabel. */
  search?: string
}

export function filterProfiles(
  profiles: ConnectionProfile[],
  filter: ProfileFilter
): ConnectionProfile[] {
  const q = filter.search?.trim().toLowerCase()
  return profiles.filter((p) => {
    if (filter.engine && p.engine !== filter.engine) return false
    if (filter.environment && p.environment !== filter.environment) return false
    if (filter.favoritesOnly && !p.favorite) return false
    if (q && !`${p.name} ${connectionLabel(p)}`.toLowerCase().includes(q)) return false
    return true
  })
}
```

- [ ] **Step 5:** Run → PASS. Full `pnpm test` (profile-store strip tests must still pass — the new fields are non-secret and persist).
- [ ] **Step 6: Form.** In `ProfileForm.tsx`, add (all engines, near the Name field): an **Environment** select (`None` → field absent / Production / Staging / Local) and a **Favorite** checkbox/star, both included in the built profile. Follow the form's existing field style.
- [ ] **Step 7: Secret-safety check.** Inspect `src/main/ipc.ts` `profiles:save`: metadata-only saves pass empty `secretFields` → the `if (password || … || uri)` guard skips `secrets.set`. Confirm; note in commit body.
- [ ] **Step 8:** Verify all green (`typecheck/lint/test/build`), commit branch `dialect-p2-t1-metadata`, PR, merge.

---

### Task 2: ConnectionManager (rail + search + cards)

**Files:** Create `src/renderer/src/components/ConnectionManager.tsx`. Modify `src/renderer/src/App.tsx` (landing only). Modify e2e specs only if selectors break.

**Interfaces:**

- Consumes: `filterProfiles`/`ProfileFilter` (T1), `useProfiles`, `useConnStore`, `connectionLabel`, `window.fordb.connection.open`, ConnectionList's connect-flow logic (copy its `connect()` semantics: double-click guard, error surface, `onConnect(connectionId, profileId, database)`).
- Produces: `<ConnectionManager variant="full" onConnect onEdit onNew />` (slim added T3).

**Acceptance:**

- Layout (full): left rail ~180px `bg-surface-1 border-r border-border` — "Engines" group: `All engines` (count), a row per engine present with count, `Favorites`; "Environments" group: Production/Staging/Local rows. Single-select per group (click again to clear); selections + search compose one `ProfileFilter` fed to `filterProfiles`.
- Main: header `Connections`, a search input (`placeholder="Search connections…"`), and a button with EXACT text `+ New connection` (e2e contract) styled Dialect-primary.
- Cards: engine badge/icon, profile label (`connectionLabel`) as the **clickable connect target** (e2e contract — clicking the label text connects), host/db secondary line, environment badge (production = `bg-warning/15 text-warning` styling; staging/local neutral muted), favorite star (display-only in T2; toggle wired T3), `connecting…` inline state + error surface (copy ConnectionList behavior).
- Empty states: zero profiles → centered CTA `+ New connection`; zero filter hits → `No connections match`.
- Landing in `App.tsx` (`view.kind !== 'connected'` sidebar slot) renders `ConnectionManager variant="full"` in the MAIN panel area (the manager is a full-page view per the mockup, not a sidebar list) — welcome text replaced. Keep the sidebar's ConnectionList usage for the in-session switcher untouched until T3.
- Run e2e: if `+ New connection` and label-click-to-connect are preserved, specs pass unchanged; fix any that don't.

Steps: implement → `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → run e2e suite → commit `dialect-p2-t2-manager`, PR, merge.

---

### Task 3: Card actions + slim variant + remove ConnectionList

**Files:** Modify `ConnectionManager.tsx`, `App.tsx`. Delete `src/renderer/src/components/ConnectionList.tsx`.

**Interfaces:** Produces `variant: 'full' | 'slim'`; favorite toggle persisting via `window.fordb.profiles.save(profile, {})`.

**Acceptance:**

- Card actions: **Connect** (already the label click), **Edit** (→ `onEdit(profile)`), **Delete** (confirm → `profiles.delete` → invalidate, copy ConnectionList's delete flow), **favorite star toggle** → saves `{...profile, favorite: !profile.favorite}` with empty secretFields → invalidate profiles. Star filled when favorite.
- `variant="slim"`: single-column compact list (no rail, keeps search), used in the connected sidebar switcher slot (replacing `ConnectionList` in App.tsx). Actions preserved.
- Delete `ConnectionList.tsx`; `grep -rn "ConnectionList" src/` must return nothing.
- e2e re-run green (connect specs go through the manager now in both places).

Steps: implement → full verify + e2e → commit `dialect-p2-t3-actions`, PR, merge.

---

### Task 4: Sidebar Dialect restyle

**Files:** Modify `src/renderer/src/components/ActiveConnectionBar.tsx`, `DatabaseSwitcher.tsx`, `SchemaTree.tsx`, `App.tsx` (sidebar container classes only).

**Acceptance:**

- Sidebar container: `bg-surface-1`, hairline `border-border-soft` separators.
- A search/palette row at the top of the connected sidebar: a muted input-look button (`Search…` + a `⌘K` keycap on the right, 11px, `bg-surface-2 border border-border rounded`) that opens the existing CommandPalette (find its open mechanism — store flag or keyboard event — and call it). No new search engine.
- ActiveConnectionBar + DatabaseSwitcher + refresh row: Dialect ink/muted text scale (13/12/11px), hover `bg-surface-2`.
- Tree rows (SchemaTree row render): hover `bg-surface-2`, selected `bg-primary/10 text-primary`, category folders (Views/Functions/Triggers) as 11px uppercase `text-muted-foreground` headers. **Class changes only — no id/handler/structure changes.**
- e2e green (tree interactions unchanged).

Steps: implement → full verify + e2e → commit `dialect-p2-t4-sidebar`, PR, merge.

**End of P2 — whole-phase review (T1–T4 diff), fix Criticals/Importants. Then P3 (editor + toolbar).**

## Self-Review

1. **Spec coverage:** metadata+form+filter (T1) · manager rail/search/cards/empty states (T2) · actions/slim/ConnectionList removal (T3) · sidebar skin + ⌘K row (T4) · secret-safety verify (T1 S7) · e2e contract (Global Constraints + T2/T3). Import/export-connections correctly out of scope.
2. **Placeholders:** T1 carries full code; T2–T4 acceptance-defined against the copied ConnectionList behaviors (connect guard, delete flow) and named token classes — consistent with prior renderer-task style.
3. **Type consistency:** `environment` union + `favorite?` (T1) used by filter/cards/badge; `filterProfiles(profiles, filter)` (T1) consumed T2; `variant: 'full' | 'slim'` (T2/T3); `onConnect(connectionId, profileId, database)` matches ConnectionList's existing callback shape used in App.tsx.

**Deliberate deferrals:** import/export connections, multi-select filters, production connect-guard.

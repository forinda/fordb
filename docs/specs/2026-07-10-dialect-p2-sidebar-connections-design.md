# Dialect Reskin — Phase 2: Sidebar + Connections Manager (Design)

**Status:** approved (full manager incl. environment/favorite metadata), ready for plan
**Date:** 2026-07-10
**Milestone:** Dialect Reskin P2 (of 6). P1 (tokens + shell) shipped.

## Goal

Rebuild the connections landing as the Dialect connections manager — filter rail (engines / favorites / environments), search, connection cards — backed by new optional profile metadata (`environment`, `favorite`), and restyle the connected sidebar (search-with-⌘K, tree skin) to Dialect. No structural tree changes.

## Profile metadata

`BaseProfile` (src/shared/adapter/types.ts) gains:

```ts
environment?: 'production' | 'staging' | 'local'
favorite?: boolean
```

Optional + non-secret → persisted in profiles JSON as-is (no `ProfileStore.save()` strip changes, no migration — absent fields render as untagged/unfavorited). `ProfileForm` gains an Environment select (None/Production/Staging/Local) + a favorite star toggle, saved on the profile for every engine.

Pure helper `src/shared/profile-filter.ts`:

```ts
export interface ProfileFilter {
  engine?: ConnectionProfile['engine']
  environment?: 'production' | 'staging' | 'local'
  favoritesOnly?: boolean
  search?: string // matches name + connectionLabel, case-insensitive
}
export function filterProfiles(
  profiles: ConnectionProfile[],
  filter: ProfileFilter
): ConnectionProfile[]
```

Unit-tested (engine/env/favorite narrowing, search over name+label, combinations, empty filter = all).

## Connections manager (replaces the ConnectionList landing)

`src/renderer/src/components/ConnectionManager.tsx` renders when not connected (and as the "switch connection" view):

- **Left rail** (~180px, `surface-1`, border-right): "Engines" group — All engines (count), one row per engine present (icon + count), Favorites; "Environments" group — Production / Staging / Local. Single-select per group; selections compose into one `ProfileFilter`.
- **Main**: header "Connections" + search input (filters as you type) + primary **New Connection** button. Below, **cards** (grid/list): engine icon, profile name, `connectionLabel` line, environment badge (Production = warning-styled red/amber badge per mockup; Staging/Local neutral), favorite star (toggles `favorite`, saves via `profiles:save` with empty secretFields — MUST NOT clobber stored secrets: saving metadata only re-persists the stripped profile and skips `secrets.set`, which the existing `if (any secret field)` guard already does), Connect / Edit / Delete actions.
- **Slim variant**: the in-session switcher (ActiveConnectionBar toggle) reuses the same card list in a compact single-column mode (a `variant: 'full' | 'slim'` prop), replacing `ConnectionList` usage there too. `ConnectionList.tsx` is then removed (superseded).
- Empty states: no profiles → centered "New Connection" CTA; filter/search with no hits → "No connections match".

## Sidebar restyle (connected)

Dialect skin on the existing structure — same nodes, handlers, and stores:

- A search input at the top with a `⌘K` keycap hint; focusing/clicking opens the existing CommandPalette (no new search engine — the palette already fuzzy-matches).
- `ActiveConnectionBar`, `DatabaseSwitcher`, refresh row restyled with Dialect tokens (surface-1 sidebar bg, border-soft hairlines, ink/muted text scale, 13/12/11px density).
- Tree rows: Dialect hover (`surface-2`), selected (`primary`/10 background + primary text), category headers (Views/Functions/Triggers) in 11px uppercase muted per mockup.
- **No structural change** to SchemaTree logic/ids/handlers (e2e must stay green).

## Testing

- Unit: `filterProfiles` (full matrix), any pure badge-label helper.
- Existing SQLite e2e must stay green (tree structure unchanged; landing changes may need e2e selector updates if they target ConnectionList — check `tests/e2e` and update selectors to the manager equivalents, keeping assertions).
- typecheck/lint/build green per task. Manual smoke: filter rail composition, favorite persistence across restart, production badge.

## Risks

- **Favorite-toggle save path clobbering secrets** — the save handler persists the stripped profile and only calls `secrets.set` when a secret field is present; toggling metadata sends none → keychain untouched. Verify by test or inspection in T1.
- **e2e selectors** — the landing DOM changes; e2e that clicks "connect" rows must be updated in the same task that changes the DOM (T2/T3), never left red.
- `ConnectionList` removal — confirm no other import sites (App.tsx has two usages: landing + switcher; both migrate).

## Out of scope (later phases)

Editor/toolbar (P3), grid/structure (P4), Mongo views (P5), palette/overlays (P6). No import/export-connections feature (mockup shows buttons; deferred — not in fordb today).

## Exit criteria

Landing = Dialect connections manager with working engine/favorites/environment rail + search + cards; env badge + favorite persist; connected sidebar wears the Dialect skin; e2e green.

## Task decomposition (for the plan)

1. **Metadata + filter helper + form** — BaseProfile fields, `filterProfiles` + unit matrix, ProfileForm env select + favorite toggle; verify metadata-only save doesn't touch keychain.
2. **ConnectionManager (rail + search + cards)** — full variant replacing the landing; empty states; e2e selector updates.
3. **Card actions + slim switcher** — Connect/Edit/Delete/favorite-toggle on cards; slim variant replaces ConnectionList in the switcher; remove ConnectionList.
4. **Sidebar restyle** — ⌘K search hint row, ActiveConnectionBar/DatabaseSwitcher/tree Dialect skin; no structural change.

## Self-review

1. **Coverage:** metadata/form (T1), manager+rail+search (T2), cards/actions/slim+removal (T3), sidebar (T4); testing + risks each named to a task.
2. **Placeholders:** none — field names, filter signature, component/file names, badge semantics concrete.
3. **Consistency:** `environment` values `'production'|'staging'|'local'` everywhere; `filterProfiles(profiles, filter)` consumed by rail+search; `variant: 'full'|'slim'`.
4. **Ambiguity:** favorite-save secret-safety stated; ⌘K = palette (no new search); ConnectionList superseded explicitly.

**Deliberate deferrals:** import/export connections; multi-select rail filters; env-based connect guards (e.g. "are you sure — production").

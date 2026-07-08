# fordb — Theming & Appearance: Design Spec

Status: Approved 2026-07-08 · Milestone: M-Appearance (after M2) · References: docs/06-prd.md (keyboard-first principle), docs/04-ui-stack.md.

Builds on the merged M2 connection manager (React 19 + Tailwind v4 + Zustand renderer). Absorbs the M2 ad-hoc contrast fixes into a real token system.

## Goal / exit criterion

shadcn/ui on the existing Tailwind v4 setup, a Radix-Colors token palette audited to WCAG AA in both themes, and light/dark/system theme switching persisted across launches with no flash of the wrong theme on startup — plus the highest-a11y-value components migrated to Radix primitives.

## Non-goals (deferred)

Accent-color choice, UI density, a full Settings/preferences panel, and migrating the schema tree to a Radix primitive. This is the appearance foundation, not a preferences suite.

## 1. Token foundation

- **Radix Colors** (`@radix-ui/colors` — CSS values only, no runtime code) provide 12-step scales with engineered light and dark pairs of known contrast.
- Map Radix steps to **shadcn's CSS-variable token set** in `src/renderer/src/index.css`: `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--primary-foreground`, `--muted`, `--muted-foreground`, `--border`, `--input`, `--ring`, `--destructive`. Defined for `:root` (light) and overridden under `.dark`.
- Tailwind v4 `@theme` binds those variables to utility classes (`bg-background`, `text-muted-foreground`, `border-border`, …); a `@custom-variant dark (&:where(.dark, .dark *))` targets the `.dark` class.
- **Migrated components use only semantic token classes** — no raw `neutral-950`/`blue-700` literals. The M2 contrast fixes become token values.
- A **contrast test** (`tests/unit/token-contrast.test.ts`) asserts key foreground/background token pairs meet AA (4.5:1 normal text, 3:1 UI/large) in both light and dark, computing WCAG contrast from the resolved token values. Because the values come from Radix's known-good steps, this is verification, not tuning.

## 2. Theme switching + persistence

- **Modes:** `light` | `dark` | `system`. `system` follows the OS via Electron **`nativeTheme`** (main process): effective theme = `nativeTheme.shouldUseDarkColors ? 'dark' : 'light'`.
- **Persistence (main-side):** a small `SettingsStore` writing `settings.json` under Electron `userData` (sibling to `profiles.json`), holding `{ theme: 'light' | 'dark' | 'system' }`. Exposed over IPC: `settings:get-theme` → mode; `settings:set-theme` (mode) → persists + applies. Main-side because `nativeTheme` and the anti-flash startup value both live there.
- **No flash on launch:** at startup main reads the persisted mode, resolves `system` to light/dark, and exposes the resolved effective theme through preload (`window.fordb.appearance.initialTheme: 'light' | 'dark'`). The renderer entry (`main.tsx`) stamps `document.documentElement.classList` with `dark`/`light` **synchronously before `createRoot().render()`** — so first paint is correct.
- **Live OS changes:** main subscribes to `nativeTheme.on('updated', …)` and pushes the new effective theme to the renderer (IPC event `appearance:theme-changed`); the renderer re-stamps `<html>` when in `system` mode.
- **State:** a Zustand `useThemeStore` holds `{ mode, effective, setMode }`. `setMode` calls `settings:set-theme` and updates the `<html>` class. UI: a theme toggle control (cycles light→dark→system or a 3-option control) **and** a command-palette command ("Theme: light", "Theme: dark", "Theme: system") — keyboard-first per PRD.

## 3. Component migration (foundation + high-value only)

Adopt shadcn components by copying them into `src/renderer/src/components/ui/` (we own the code). Migrate selectively:

- **Command palette → `cmdk`** (shadcn `Command`): replaces the hand-rolled `CommandPalette` — fuzzy search, groups, focus trap, ARIA roles. Ctrl/Cmd+K keeps working; the existing command list (New connection, Disconnect, + the new Theme commands) feeds it.
- **Select** → Radix Select (shadcn `Select`): the SSH auth-method dropdown in ProfileForm.
- **Dialog** primitive (shadcn `Dialog`) available for the palette overlay and future modals.
- **Input / Button / Label / Checkbox** → shadcn variants: ProfileForm and ConnectionList inherit consistent tokens + focus-visible rings from one place (retires the repeated per-element focus classes added in the M2 a11y pass).
- **Left as-is:** the schema tree (react-arborist) — restyled with token classes but not re-primitived.

shadcn scaffolding: `components.json`, a `lib/utils.ts` exporting `cn()` (clsx + tailwind-merge). Configure the shadcn CLI to output into the renderer's paths.

## 4. Dependencies (kept lean)

`@radix-ui/colors` (CSS), plus the Radix primitives shadcn pulls per migrated component: `@radix-ui/react-select`, `@radix-ui/react-dialog`, `cmdk`, `class-variance-authority`, `clsx`, `tailwind-merge`. All tree-shakeable; components are copied-in, not a monolithic UI dependency. No component library runtime beyond the Radix primitives actually used.

## 5. Testing

- **Token contrast** (`token-contrast.test.ts`): AA assertions on the palette's key pairs, both themes.
- **Theme resolution logic** (`resolveTheme(mode, systemDark) → 'light' | 'dark'`) unit-tested (a pure function; the effective-theme rule).
- **SettingsStore** round-trip unit test (temp dir, like ProfileStore).
- **Playwright** (desktop/keyring-CI): toggle theme via the palette → `<html>` class changes; relaunch → persisted mode restored; no wrong-theme flash (assert `<html>` class present before first content paint if feasible, else assert applied theme).
- Existing 26 tests stay green. Migrated components must not regress the M2 connect flow (the connect e2e still passes).

## 6. Success criteria

1. Light, dark, and system all render with AA-contrast tokens; `system` follows the OS live.
2. The chosen mode persists across relaunch; no flash of the wrong theme at startup.
3. Theme is reachable by keyboard (command-palette commands).
4. The command palette runs on `cmdk`; the SSH auth Select and the form controls are Radix-based and keyboard/screen-reader accessible.
5. No raw color literals remain in migrated components — all semantic tokens.

## 7. Risks

| Risk                                                            | Mitigation                                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| shadcn CLI assumes a Next.js/standard layout, not electron-vite | Configure `components.json` paths manually; copy component source directly if the CLI fights the layout — we own the files either way |
| Migrating CommandPalette regresses the Task 12 e2e              | Keep the Ctrl/Cmd+K contract + command list identical; re-run the connect e2e after migration                                         |
| Radix→shadcn tokens drift from Tailwind v4's `@theme` wiring    | Single source: define tokens once in index.css, bind via `@theme`, audit with the contrast test                                       |
| Flash-of-wrong-theme is subtle to verify headless               | Deterministic unit test on `resolveTheme` + startup stamp ordering asserted; visual confirm on a real desktop                         |

## Decisions made during design (not asked)

- Theme preference persists **main-side** (`settings.json`) — required for `nativeTheme` and the no-flash startup value.
- Anti-flash: renderer entry stamps the `<html>` theme class synchronously before React mounts, using an initial value provided by preload.
- shadcn components copied into `components/ui/`; only the primitives actually used are pulled in (lean).

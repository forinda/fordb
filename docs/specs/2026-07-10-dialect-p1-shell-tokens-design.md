# Dialect Reskin — Phase 1: Design Tokens + App Shell (Design)

**Status:** approved (phased full reskin; P1 = tokens + shell), ready for plan
**Date:** 2026-07-10
**Milestone:** Dialect Reskin P1 (of 6)

## Context

Adopt the "Dialect DB Client" visual design (Claude Design project `ba155b59-eb50-46ac-bbdb-a9dac6083d64`, file `Dialect DB Client.dc.html`) across the fordb renderer as a **phased full reskin** — each phase its own spec → plan → per-task-PR cycle, same discipline as M1–M7.

**Phase map:** P1 tokens + app shell → P2 sidebar + connections manager → P3 editor + toolbar + query bar → P4 results grid + structure → P5 Mongo docs/indexes + pending tray → P6 command palette + overlays/toasts.

**This spec is P1 only.** It establishes the design-token layer the whole app inherits, plus the app-shell chrome (frameless custom title bar + status bar). Inner components are untouched in P1 — they inherit the new palette and may look transitional until their phase.

**Framing (explicit assumption):** the mockup renders the app as a floating rounded 1440×900 card on a gradient backdrop with an outer drop shadow. That is the _design canvas_, not a UI to build. The real app **is** the OS window (frameless, fills its own bounds). We implement the window _contents_ — no fake window-in-a-window backdrop / outer radius / outer shadow.

## Goal

Redefine and extend the existing CSS-var token layer to the Dialect design system (light exact + derived dark, theme toggle preserved), make the window frameless with a custom Dialect title bar (own min/max/close controls, cross-platform), and add a Dialect status bar — restructuring `App.tsx` into a `TitleBar / body / StatusBar` shell.

## Current state (what we build on)

- **Tokens:** `src/renderer/src/index.css` — Tailwind v4 (no config file); CSS vars in `:root` + `.dark`, mapped to Tailwind colors via `@theme inline`. Today only 11 tokens (background/foreground/muted/card/border/primary/destructive/ring + foregrounds).
- **Theme:** class-based (`.dark`/`.light` on `document.documentElement`). `store-theme.ts` (Zustand) holds `mode` (`light|dark|system`) + `effective`; main computes `effective` and broadcasts via `window.fordb.appearance.onThemeChanged`. `ThemeToggle.tsx` cycles modes. `cm-theme.ts` tracks the effective theme for CodeMirror.
- **Window:** `src/main/index.ts:104` — standard OS-framed `BrowserWindow` (1200×800), no `frame`/`titleBarStyle`.
- **Shell:** `App.tsx` renders welcome/form/connected views directly (no title/status bar). Body = sidebar (`SchemaTree`/`ConnectionList`) + `QueryWorkbench`/dashboards in a `ResizablePanelGroup`.

## Design tokens (Dialect)

Extracted from the mockup. Extend **both** `:root` (light, exact) and `.dark` (derived from the mockup's navy chrome), and add matching `@theme inline` mappings so Tailwind utility classes resolve.

**Light (`:root`) — Dialect values:**

| token                  | value                           | role                   |
| ---------------------- | ------------------------------- | ---------------------- |
| `--background`         | `#ffffff`                       | app base               |
| `--surface-1`          | `#f8fafd`                       | raised panels          |
| `--surface-2`          | `#f4f7fb`                       | inset/toolbar          |
| `--surface-3`          | `#eef2f8`                       | deeper inset           |
| `--foreground`         | `#1a2740`                       | primary ink            |
| `--foreground-soft`    | `#33465f`                       | secondary ink          |
| `--muted-foreground`   | `#5b6f8c`                       | muted                  |
| `--muted-foreground-2` | `#7488a6`                       | fainter                |
| `--faint`              | `#93a3bd`                       | placeholder/disabled   |
| `--border`             | `#dbe3ef`                       | default border         |
| `--border-soft`        | `#e4eaf3`                       | hairline               |
| `--border-strong`      | `#c9d6ee`                       | emphasized             |
| `--primary`            | `#2563eb`                       | accent                 |
| `--primary-hover`      | `#1d4ed8`                       | accent hover           |
| `--primary-foreground` | `#ffffff`                       | on-accent text         |
| `--ring`               | `rgba(37,99,235,.4)`            | focus ring color       |
| `--chrome`             | `#0f2140`                       | title bar base         |
| `--chrome-2`           | `#0b1830`                       | title bar gradient end |
| `--chrome-foreground`  | `#e7eefc`                       | title bar text         |
| `--success`            | `#16a34a` / dark text `#177a48` | ok state               |
| `--warning`            | `#f0a35e`                       | warn                   |
| `--info`               | `#8a52d6`                       | purple accent          |
| `--destructive`        | `#c62a2f` (keep)                | error                  |

**Radii:** `--radius-sm:6px --radius:8px --radius-lg:9px --radius-pill:20px --radius-card:12px`.
**Shadows:** `--shadow-raised:0 1px 2px rgba(15,33,64,.12); --shadow-pop:0 12px 30px -8px rgba(0,0,0,.5); --shadow-modal:0 30px 80px -20px rgba(0,0,0,.5); --focus-ring:0 0 0 3px rgba(37,99,235,.2)`.
**Type scale:** the design is dense — base `13px`, secondary `12px`, meta `11px`, micro `9–10px`, headings `15/16/18px`. Expose as `--text-xs:11px --text-sm:12px --text-base:13px --text-lg:15px --text-xl:18px` (used incrementally; P1 sets tokens, later phases apply).

**Dark (`.dark`) — derived:** same token _names_, values derived from the mockup's navy chrome as the dark surface family (`--background:#0b1830`, `--surface-1:#0f2140`, `--surface-2:#132741`, ink `#e7eefc`/`#c9d6ee`, borders `rgba(255,255,255,.08/.14)`, `--primary:#5c9dff`, `--chrome:#0b1830`). Chosen so the dark toggle stays coherent; refined per-component in later phases.

**Backward-compat:** keep the current token names (`--muted`, `--card`) as aliases to the nearest Dialect token so existing component classes don't break mid-reskin. Remove aliases as each component migrates in its phase.

## Frameless custom title bar

- **Main** (`src/main/index.ts`): `BrowserWindow({ frame: false, … })`; on `darwin` add `titleBarStyle: 'hiddenInset'` (native traffic-lights in the bar's left inset) — Linux/Windows use our own controls. Keep min sizes so the window can't collapse below usable.
- **Window-controls IPC** (`src/main/index.ts` + preload): `window:minimize`, `window:maximize` (toggles maximize/unmaximize), `window:close`, and `window:isMaximized` + a `window:maximize-changed` broadcast so the maximize button shows the restore icon when maximized. Exposed on `window.fordb.windowControls`.
- **`TitleBar.tsx`** (new): 44px bar, `linear-gradient(180deg,var(--chrome),var(--chrome-2))`, `--chrome-foreground` text. Left: app name + active-connection label (from `useConnStore`). Right: custom minimize / maximize-restore / close buttons (Dialect-styled; hidden on `darwin` where native lights show). `-webkit-app-region: drag` on the bar; `no-drag` on all buttons + the connection label if interactive.
- **Platform:** the renderer learns the platform via a preload-exposed `window.fordb.platform` (`'darwin'|'win32'|'linux'`) to lay out controls/inset correctly.

## Status bar

- **`StatusBar.tsx`** (new): ~24px bottom bar, `--surface-2` bg, `--border` top. Shows connection state + engine badge (from `useConnStore`), the active result's row-count/elapsed (from `useQueryStore`), and background hints. Reuses whatever the current UI surfaces for these; restyled to Dialect. `ThemeToggle` relocates here (or into the title bar) — pick the status bar to keep the title bar clean.

## App shell restructure

`App.tsx` → a full-height flex column: `<TitleBar/>` · `<div class="flex-1 min-h-0">{existing welcome/form/connected body}</div>` · `<StatusBar/>`. The body (sidebar + panels + dashboards) is otherwise **unchanged** in P1 — it inherits the new tokens. Move the current `ThemeToggle` placement into `StatusBar`.

## Testing

- **Unit:** the maximize-state reducer / any pure title-bar logic (e.g. control-set selection by platform); token presence is compile/visual, not unit-tested.
- **Build/lint/typecheck** green. **No headless e2e** for window controls (same keychain/headless gap as the rest) — manual smoke on Linux: drag, min/max/restore/close, resize borders still work, theme toggle still switches light/dark.
- No db-host / contract impact.

## Risks

- **Frameless traps:** verify OS resize still works (frameless retains resize borders by default) and the window is never uncloseable (our close button always present off-macOS; native lights on macOS). Verify drag region doesn't swallow clicks on interactive title-bar items (`no-drag`).
- **Token churn:** redefining `--primary` etc. recolors every existing component at once. The compat aliases keep structure intact; expect a transitional look until later phases — acceptable and stated.
- **macOS inset:** `hiddenInset` positions native lights; our left content must not overlap them (add left padding on `darwin`).

## Out of scope (later phases)

Sidebar/connections (P2), editor/toolbar (P3), results/structure (P4), Mongo views/pending tray (P5), command palette/overlays/toasts (P6). P1 only sets tokens + shell chrome.

## Exit criteria

Frameless window with a Dialect title bar (working min/max/close + drag + resize) and a Dialect status bar; the whole app recolored to the Dialect token system with the light/dark toggle intact; build/typecheck/lint green.

## Task decomposition (for the plan)

1. **Token layer** — extend `index.css` `:root`/`.dark`/`@theme inline` with the Dialect token set + compat aliases; verify existing components still render (typecheck/build).
2. **Frameless window + controls IPC** — `frame:false` (+ mac `hiddenInset`), `window:*` IPC, preload `windowControls` + `platform`, unit-test the platform/maximize logic.
3. **TitleBar.tsx** — the bar, drag regions, custom controls wired to `windowControls`, connection label, mac inset handling.
4. **StatusBar.tsx + shell restructure** — status bar wired to store state, `App.tsx` column layout, relocate `ThemeToggle`.

## Self-review

1. **Coverage:** tokens (§Design tokens, T1) · frameless+controls (§Frameless, T2) · title bar (§Frameless/TitleBar, T3) · status bar + shell (§Status bar/§App shell, T4) · dark derived (§Design tokens) · theme toggle preserved (§Status bar). All covered.
2. **Placeholders:** none — token values, IPC channel names, file names, and the shell structure are concrete.
3. **Consistency:** token names used identically across the light/dark maps and `@theme inline`; `window:minimize/maximize/close/isMaximized` + `window.fordb.windowControls`/`.platform` consistent between main, preload, and TitleBar.
4. **Ambiguity:** the floating-card-vs-real-window framing is stated; compat aliases prevent a broken transitional state; macOS vs Linux/Windows control handling is explicit.

**Deliberate deferrals:** all inner-component restyling (P2–P6); a Dialect-specific dark palette refinement per component; any layout change to sidebar/panels.

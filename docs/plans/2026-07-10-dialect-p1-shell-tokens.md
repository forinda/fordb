# Dialect Reskin — Phase 1 (Tokens + App Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the fordb app shell to the Dialect design — extend the CSS-var token layer to the Dialect palette (light + derived dark, toggle preserved), make the window frameless with a custom Dialect title bar, and add a Dialect status bar.

**Architecture:** Tokens flow through the existing `index.css` `:root`/`.dark` → `@theme inline` Tailwind v4 layer (redefine values + add tokens + compat aliases). The window becomes `frame:false`; a `TitleBar.tsx` provides drag + custom min/max/close wired through a new `window:*` IPC set exposed on `window.fordb.windowControls`. `App.tsx` becomes a `TitleBar / body / StatusBar` column. Inner components are untouched — they inherit the new tokens.

**Tech Stack:** Electron (main + preload + contextBridge), React 19 + Tailwind v4 (no config file, CSS `@theme inline`), Zustand, `unplugin-icons` (`~icons/lucide/*`), vitest.

**Spec:** `docs/specs/2026-07-10-dialect-p1-shell-tokens-design.md`

## Global Constraints

- TypeScript strict, no `any`. Secrets/db unaffected — no db-host or contract impact in this phase.
- Preserve the working light/dark theme toggle (`store-theme.ts` / `window.fordb.appearance`); dark values are derived, not dropped.
- **Real OS window, not a floating card** — implement window _contents_; no outer backdrop/radius/shadow.
- Keep current token names (`--muted`, `--card`, etc.) as **compat aliases** to the nearest Dialect token so existing components don't break mid-reskin.
- Cross-platform: our own min/max/close controls on Linux/Windows; macOS uses `titleBarStyle:'hiddenInset'` native traffic-lights (hide our controls on `darwin`).
- No headless e2e for window controls (keychain/headless gap) — pure logic is unit-tested; window behavior is manual-smoke on Linux.
- Per-task PR against `main`. Commit body ends with the Co-Authored-By + Claude-Session trailers. `pnpm exec prettier --write` touched files. Verify `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green each task.

## File Structure

- `src/renderer/src/index.css` — MODIFY: Dialect token set in `:root`/`.dark`, `@theme inline` mappings, compat aliases.
- `src/main/index.ts` — MODIFY: `frame:false` (+ mac `hiddenInset`), `window:*` IPC handlers, maximize-change broadcast.
- `src/preload/index.ts` — MODIFY: expose `window.fordb.windowControls` + `window.fordb.platform`.
- `src/renderer/src/rpc.ts` — MODIFY: ambient `Window.fordb` type augmentation for the new preload surface.
- `src/shared/window-controls.ts` — CREATE: pure helpers (`controlMode(platform)`, maximize-icon selection) + their types.
- `src/renderer/src/components/TitleBar.tsx` — CREATE.
- `src/renderer/src/components/StatusBar.tsx` — CREATE.
- `src/renderer/src/App.tsx` — MODIFY: `TitleBar / body / StatusBar` column; relocate `ThemeToggle` into `StatusBar`.
- Tests: `tests/unit/window-controls.test.ts`.

---

### Task 1: Dialect token layer

**Files:**

- Modify: `src/renderer/src/index.css`

**Interfaces:**

- Produces: the Dialect CSS-var token set on `:root` (light) and `.dark` (derived), mapped through `@theme inline`; compat aliases `--muted`/`--card` retained. Tailwind utilities (`bg-background`, `text-foreground`, `border-border`, `bg-primary`, etc.) resolve to Dialect values.

- [ ] **Step 1: Replace the `:root` block** in `src/renderer/src/index.css` with the Dialect light tokens (keeping `--muted`/`--card` as compat aliases):

```css
:root {
  --background: #ffffff;
  --surface-1: #f8fafd;
  --surface-2: #f4f7fb;
  --surface-3: #eef2f8;
  --foreground: #1a2740;
  --foreground-soft: #33465f;
  --muted-foreground: #5b6f8c;
  --muted-foreground-2: #7488a6;
  --faint: #93a3bd;
  --border: #dbe3ef;
  --border-soft: #e4eaf3;
  --border-strong: #c9d6ee;
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --primary-foreground: #ffffff;
  --ring: #2563eb;
  --chrome: #0f2140;
  --chrome-2: #0b1830;
  --chrome-foreground: #e7eefc;
  --success: #16a34a;
  --warning: #f0a35e;
  --info: #8a52d6;
  --destructive: #c62a2f;
  --destructive-foreground: #ffffff;
  /* compat aliases (removed as components migrate in later phases) */
  --muted: #f4f7fb;
  --card: #ffffff;
  --radius-sm: 6px;
  --radius: 8px;
  --radius-lg: 9px;
  --radius-pill: 20px;
  --radius-card: 12px;
  --shadow-raised: 0 1px 2px rgba(15, 33, 64, 0.12);
  --shadow-pop: 0 12px 30px -8px rgba(0, 0, 0, 0.5);
  --shadow-modal: 0 30px 80px -20px rgba(0, 0, 0, 0.5);
  --focus-ring: 0 0 0 3px rgba(37, 99, 235, 0.2);
}
```

- [ ] **Step 2: Replace the `.dark` block** with derived-dark values (same token names):

```css
.dark {
  --background: #0b1830;
  --surface-1: #0f2140;
  --surface-2: #132741;
  --surface-3: #17304d;
  --foreground: #e7eefc;
  --foreground-soft: #c9d6ee;
  --muted-foreground: #93a3bd;
  --muted-foreground-2: #7488a6;
  --faint: #5f7295;
  --border: rgba(255, 255, 255, 0.1);
  --border-soft: rgba(255, 255, 255, 0.06);
  --border-strong: rgba(255, 255, 255, 0.16);
  --primary: #5c9dff;
  --primary-hover: #7cb0ff;
  --primary-foreground: #0b1220;
  --ring: #5c9dff;
  --chrome: #0b1830;
  --chrome-2: #081222;
  --chrome-foreground: #e7eefc;
  --success: #37c579;
  --warning: #f0a35e;
  --info: #b083ec;
  --destructive: #ff6369;
  --destructive-foreground: #1a0d0d;
  --muted: #132741;
  --card: #0f2140;
  --radius-sm: 6px;
  --radius: 8px;
  --radius-lg: 9px;
  --radius-pill: 20px;
  --radius-card: 12px;
  --shadow-raised: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-pop: 0 12px 30px -8px rgba(0, 0, 0, 0.6);
  --shadow-modal: 0 30px 80px -20px rgba(0, 0, 0, 0.7);
  --focus-ring: 0 0 0 3px rgba(92, 157, 255, 0.28);
}
```

- [ ] **Step 3: Extend the `@theme inline` block** so the new tokens become Tailwind utilities (keep the existing lines, add these):

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-foreground-soft: var(--foreground-soft);
  --color-surface-1: var(--surface-1);
  --color-surface-2: var(--surface-2);
  --color-surface-3: var(--surface-3);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted-foreground-2: var(--muted-foreground-2);
  --color-faint: var(--faint);
  --color-card: var(--card);
  --color-border: var(--border);
  --color-border-soft: var(--border-soft);
  --color-border-strong: var(--border-strong);
  --color-primary: var(--primary);
  --color-primary-hover: var(--primary-hover);
  --color-primary-foreground: var(--primary-foreground);
  --color-chrome: var(--chrome);
  --color-chrome-2: var(--chrome-2);
  --color-chrome-foreground: var(--chrome-foreground);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-info: var(--info);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-ring: var(--ring);
}
```

- [ ] **Step 4: Verify.** `pnpm typecheck && pnpm lint && pnpm build`. Expected: green (no TS/lint impact; Tailwind compiles the new tokens). Existing components render recolored (via `--primary`/`--background`/`--border` + compat aliases) with no structural change.

- [ ] **Step 5: Commit.** Branch `dialect-p1-t1-tokens`; `feat: Dialect design token layer (light + derived dark) (Dialect P1 T1)`. PR, do not merge.

---

### Task 2: Frameless window + window-controls IPC

**Files:**

- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/rpc.ts`
- Create: `src/shared/window-controls.ts`
- Test: `tests/unit/window-controls.test.ts`

**Interfaces:**

- Produces: `window.fordb.platform: 'darwin'|'win32'|'linux'`; `window.fordb.windowControls: { minimize(): void; maximize(): void; close(): void; isMaximized(): Promise<boolean>; onMaximizeChanged(cb: (max: boolean) => void): void }`. Pure `controlMode(platform)` → `'native'|'custom'` in `src/shared/window-controls.ts`.

- [ ] **Step 1: Write the failing test** — `tests/unit/window-controls.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { controlMode } from '../../src/shared/window-controls'

describe('controlMode', () => {
  it('uses native controls on macOS (hiddenInset traffic lights)', () => {
    expect(controlMode('darwin')).toBe('native')
  })
  it('uses custom controls on Linux and Windows', () => {
    expect(controlMode('linux')).toBe('custom')
    expect(controlMode('win32')).toBe('custom')
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`controlMode` not defined): `pnpm test -- window-controls`

- [ ] **Step 3: Implement `src/shared/window-controls.ts`:**

```ts
export type Platform = 'darwin' | 'win32' | 'linux'

/** macOS shows native traffic-lights via titleBarStyle:'hiddenInset'; every
 *  other platform renders our own min/max/close buttons in the TitleBar. */
export function controlMode(platform: Platform): 'native' | 'custom' {
  return platform === 'darwin' ? 'native' : 'custom'
}
```

- [ ] **Step 4: Run — expect PASS.** `pnpm test -- window-controls`

- [ ] **Step 5: Frameless window + IPC** — `src/main/index.ts`. Change the `BrowserWindow` construction (currently at ~line 104) to be frameless, and add window-controls IPC + maximize broadcast. Replace the `createWindow` window construction with:

```ts
const win = new BrowserWindow({
  width: 1200,
  height: 800,
  minWidth: 720,
  minHeight: 480,
  frame: false,
  ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
  webPreferences: {
    preload: join(__dirname, '../preload/index.mjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  }
})
win.on('maximize', () => win.webContents.send('window:maximize-changed', true))
win.on('unmaximize', () => win.webContents.send('window:maximize-changed', false))
```

Add these IPC handlers near the other `ipcMain` registrations (module scope, after the `db-host:request-port` handler). Use the sender's window so multi-window is safe:

```ts
ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
ipcMain.on('window:maximize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w) return
  if (w.isMaximized()) w.unmaximize()
  else w.maximize()
})
ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
ipcMain.handle('window:is-maximized', (e) =>
  Boolean(BrowserWindow.fromWebContents(e.sender)?.isMaximized())
)
```

- [ ] **Step 6: Preload surface** — `src/preload/index.ts`. Inside the object passed to `exposeInMainWorld('fordb', { … })`, add (alongside `appearance`):

```ts
  platform: process.platform as 'darwin' | 'win32' | 'linux',
  windowControls: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    maximize: (): void => ipcRenderer.send('window:maximize'),
    close: (): void => ipcRenderer.send('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChanged: (cb: (max: boolean) => void): void => {
      ipcRenderer.on('window:maximize-changed', (_e, max: boolean) => cb(max))
    }
  },
```

- [ ] **Step 7: Type augmentation** — `src/renderer/src/rpc.ts`. Extend the ambient `Window['fordb']` interface with:

```ts
    platform: 'darwin' | 'win32' | 'linux'
    windowControls: {
      minimize: () => void
      maximize: () => void
      close: () => void
      isMaximized: () => Promise<boolean>
      onMaximizeChanged: (cb: (max: boolean) => void) => void
    }
```

- [ ] **Step 8: Verify.** `pnpm test -- window-controls && pnpm typecheck && pnpm lint && pnpm build`. Expected: unit green, compile clean. (Frameless behavior is manual-smoke — deferred to the phase-end check.)

- [ ] **Step 9: Commit.** Branch `dialect-p1-t2-frameless`; `feat: frameless window + window-controls IPC (Dialect P1 T2)`. PR, do not merge.

---

### Task 3: TitleBar component

**Files:**

- Create: `src/renderer/src/components/TitleBar.tsx`

**Interfaces:**

- Consumes: `window.fordb.platform`, `window.fordb.windowControls` (T2); `useConnStore` (active connection), `connectionLabel` (`@shared/connection-label`), `useProfiles` (`../query/profiles`) — mirror `ActiveConnectionBar.tsx`; `controlMode` (`@shared/window-controls`); icons `~icons/lucide/minus`, `~icons/lucide/square`, `~icons/lucide/copy`, `~icons/lucide/x`.
- Produces: `<TitleBar />` — a 44px draggable navy bar with app title + active-connection label and (off-macOS) custom min/max/close controls.

**Acceptance:**

- 44px bar, full width, `background: linear-gradient(180deg, var(--chrome), var(--chrome-2))`, text `text-chrome-foreground`. `style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}` on the bar; `WebkitAppRegion: 'no-drag'` on all buttons.
- Left: on `darwin`, a ~70px spacer so content clears the native traffic-lights; then the app name ("fordb") + the active connection label (`connectionLabel(profile)` when connected, mirroring `ActiveConnectionBar`; blank/"fordb" otherwise).
- Right: when `controlMode(window.fordb.platform) === 'custom'`, render minimize / maximize-restore / close buttons wired to `window.fordb.windowControls`. Track maximized state via `isMaximized()` on mount + `onMaximizeChanged` to swap the maximize icon (square) ↔ restore icon (copy). The close button gets a red hover (`hover:bg-destructive hover:text-destructive-foreground`). On `darwin`, render no custom controls.
- Buttons: 46px×44px hit areas, `hover:bg-white/10`, focusable (`focus-visible:ring`). Use `aria-label` on each.

- [ ] **Step 1: Implement `TitleBar.tsx`** per acceptance (mirror `ActiveConnectionBar.tsx` for the connection label; use `useState`/`useEffect` for maximized state).
- [ ] **Step 2: Verify.** `pnpm typecheck && pnpm lint && pnpm build`. (Rendered/wired via Task 4; a standalone render isn't in App yet — that's Task 4. Ensure it compiles and imports resolve.)
- [ ] **Step 3: Commit.** Branch `dialect-p1-t3-titlebar`; `feat: Dialect TitleBar with custom window controls (Dialect P1 T3)`. PR, do not merge.

---

### Task 4: StatusBar + shell restructure

**Files:**

- Create: `src/renderer/src/components/StatusBar.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**

- Consumes: `TitleBar` (T3); `useConnStore` (connection state + engine), `useQueryStore` (active tab row-count/elapsed/status), `ThemeToggle` (`./components/ThemeToggle`).
- Produces: `<StatusBar />`; `App.tsx` as a `TitleBar / body / StatusBar` full-height column.

**Acceptance:**

- **StatusBar**: ~24px bottom bar, `bg-surface-2 border-t border-border text-xs text-muted-foreground`, flex row. Left: connection state — "Connected · <engine>" (engine from the active connection's profile via `useConnStore`/`useProfiles`) or "Not connected". Center/right: the active query tab's status — row count + elapsed (`elapsedMs`) when a result is present (read from `useQueryStore`'s active tab, mirroring what the workbench footer shows today). Far right: `<ThemeToggle />` (restyled inline is fine; move the existing element here). Everything degrades gracefully when nothing is connected/run.
- **App.tsx**: wrap the returned tree in `<div className="flex h-screen flex-col overflow-hidden"> <TitleBar/> <div className="min-h-0 flex-1"> {existing view body} </div> <StatusBar/> </div>`. Remove the standalone `<ThemeToggle />` at its current spot (line ~222) — it now lives in `StatusBar`. The welcome/form/connected branches are otherwise unchanged.

- [ ] **Step 1: Implement `StatusBar.tsx`** per acceptance (read active-tab result info from `useQueryStore`; connection/engine from `useConnStore` + `useProfiles`).
- [ ] **Step 2: Restructure `App.tsx`** into the `TitleBar / body / StatusBar` column; relocate `ThemeToggle`.
- [ ] **Step 3: Verify.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Expected: green. Manual smoke (documented, not automated): `pnpm dev` (or `pnpm dev:sandboxless`) → frameless window, drag by title bar, min/max/restore/close work, resize borders work, theme toggle switches light/dark, status bar shows connection + result info.
- [ ] **Step 4: Commit.** Branch `dialect-p1-t4-statusbar-shell`; `feat: Dialect StatusBar + app-shell restructure (Dialect P1 T4)`. PR, do not merge.

**End of Phase 1 — whole-branch review over T1–T4, fix Criticals/Importants. Then P2 (sidebar + connections manager) gets its own spec → plan.**

## Self-Review

1. **Spec coverage:** tokens light+dark+`@theme` (§Design tokens → T1) · frameless+controls IPC+preload+platform (§Frameless → T2) · TitleBar drag/controls/label/mac-inset (§Frameless/TitleBar → T3) · StatusBar + shell restructure + ThemeToggle relocation (§Status bar/§App shell → T4). All covered. Testing (§Testing) → T2 unit + per-task verify + T4 manual-smoke note. Risks (§Risks) → T2 min-size/frameless + T4 smoke checklist.
2. **Placeholder scan:** T1/T2 carry full code (CSS + IPC + preload + pure helper + test). T3/T4 are acceptance-defined React components against named existing patterns (`ActiveConnectionBar` for the label, `QueryWorkbench` footer for result info) with every consumed interface (`windowControls`, `controlMode`, `useConnStore`, `useQueryStore`) fully typed in an earlier task/the codebase — same prose-acceptance style used for MA/M7 renderer tasks.
3. **Type consistency:** `controlMode(platform)`, `window.fordb.platform`, `window.fordb.windowControls.{minimize,maximize,close,isMaximized,onMaximizeChanged}`, the `window:minimize/maximize/close/is-maximized/maximize-changed` channel names, and the token names (`--chrome`, `--surface-2`, `--primary-hover`) are used identically across main (T2), preload (T2), rpc.ts (T2), TitleBar (T3), StatusBar/App (T4), and index.css (T1).

**Deliberate deferrals:** all inner-component restyling (P2–P6); per-component dark-palette refinement; any sidebar/panel layout change.

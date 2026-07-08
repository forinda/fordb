# fordb Theming & Appearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** shadcn/ui on the existing Tailwind v4 setup with a Radix-Colors token palette audited to WCAG AA, and light/dark/system theme switching persisted across launches with no flash of the wrong theme on startup.

**Architecture:** Design tokens are CSS variables (shadcn shape) fed from Radix Colors, defined once in `index.css` for `:root` (light) and `.dark`, bound to Tailwind utilities via `@theme`. Theme mode (`light|dark|system`) persists main-side in `settings.json`; `system` resolves via Electron `nativeTheme`. The renderer stamps `<html>` synchronously before React mounts to avoid a flash. Highest-a11y-value components migrate to shadcn/Radix primitives; the schema tree is only restyled.

**Tech Stack:** Tailwind v4, `@radix-ui/colors`, shadcn components (Radix primitives + `cmdk` + `class-variance-authority` + `clsx` + `tailwind-merge`), Electron `nativeTheme` + `safeStorage`-adjacent settings file, Zustand, vitest.

## Global Constraints

- pnpm; Node >= 22; TypeScript strict; no `any` except typed casts at the RPC/serialization boundary (`unknown`).
- Migrated components use ONLY semantic token classes (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, …) — no raw `neutral-*`/`blue-*`/`red-*` literals.
- Theme preference persists main-side in `settings.json` under Electron `userData`. `system` mode follows `nativeTheme`.
- No flash of wrong theme: `<html>` theme class stamped before `createRoot().render()`.
- Contrast: key token pairs meet WCAG AA (4.5:1 normal text, 3:1 UI/large) in BOTH themes, asserted by a test.
- The command palette keeps its Ctrl/Cmd+K + Escape contract; the Task 12 connect e2e must still pass after the cmdk migration.
- New deps limited to: `@radix-ui/colors`, `class-variance-authority`, `clsx`, `tailwind-merge`, `cmdk`, `@radix-ui/react-select`, `@radix-ui/react-dialog`. No others without a plan change.
- The existing 28 unit + 20 contract tests stay green. Every task ends with `pnpm typecheck && pnpm lint && pnpm test` passing and, for tasks touching renderer/build, `pnpm build`.

## File Structure (end state)

```
src/renderer/src/
  index.css                 # MODIFY: Radix imports + shadcn token vars (:root/.dark) + @theme + dark variant
  lib/utils.ts              # NEW: cn() helper
  lib/theme.ts              # NEW: resolveTheme(mode, systemDark), ThemeMode type
  store-theme.ts            # NEW: useThemeStore
  components/ui/            # NEW: shadcn components (button, input, label, checkbox, select, command, dialog)
  components/ThemeToggle.tsx # NEW
  components/CommandPalette.tsx # MODIFY: rebuild on cmdk
  components/ProfileForm.tsx    # MODIFY: shadcn Input/Button/Label/Checkbox/Select, token classes
  components/ConnectionList.tsx # MODIFY: shadcn Button, token classes
  components/SchemaTree.tsx     # MODIFY: token classes only
  App.tsx, main.tsx         # MODIFY: anti-flash stamp, theme commands, ThemeToggle
components.json             # NEW: shadcn config
src/main/
  settings-store.ts         # NEW: SettingsStore (settings.json)
  index.ts                  # MODIFY: nativeTheme, initial theme resolution, IPC
  ipc.ts                    # MODIFY: settings:get-theme / set-theme handlers
src/preload/index.ts        # MODIFY: window.fordb.appearance.{initialTheme, getMode, setMode, onThemeChanged}
tests/unit/
  theme.test.ts             # NEW: resolveTheme
  settings-store.test.ts    # NEW: SettingsStore round-trip
  token-contrast.test.ts    # NEW: AA assertions on token pairs
```

---

### Task 1: Radix-Colors token palette + Tailwind wiring + contrast test

**Files:**

- Modify: `src/renderer/src/index.css`
- Create: `tests/unit/token-contrast.test.ts`, `src/renderer/src/lib/tokens.ts`

**Interfaces:**

- Produces: semantic Tailwind classes (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `text-primary-foreground`, `bg-card`, `border-border`, `bg-destructive`, `ring`), defined for light (`:root`) and dark (`.dark`). `src/renderer/src/lib/tokens.ts` exports the raw hex values per theme so the contrast test can assert on them without a browser.

- [ ] **Step 1: Install Radix Colors**

```bash
pnpm add @radix-ui/colors
```

- [ ] **Step 2: Define the token values (single source for CSS + test)**

`src/renderer/src/lib/tokens.ts` — pick concrete accessible values from Radix scales (slate for neutrals, blue for primary, red for destructive). These are the resolved sRGB hex used both in CSS and the contrast test:

```ts
export type ThemeName = 'light' | 'dark'

export interface TokenSet {
  background: string
  foreground: string
  muted: string
  mutedForeground: string
  card: string
  border: string
  primary: string
  primaryForeground: string
  destructive: string
  destructiveForeground: string
  ring: string
}

// Values chosen from Radix Colors (slate/blue/red) for AA contrast in each theme.
export const TOKENS: Record<ThemeName, TokenSet> = {
  light: {
    background: '#ffffff', // slate 1
    foreground: '#1c2024', // slate 12
    muted: '#f1f3f5', // slate 3
    mutedForeground: '#60646c', // slate 11
    card: '#ffffff',
    border: '#d9dce1', // slate 6
    primary: '#0d5bd1', // blue 10 (AA with white text)
    primaryForeground: '#ffffff',
    destructive: '#c62a2f', // red 10
    destructiveForeground: '#ffffff',
    ring: '#0d5bd1'
  },
  dark: {
    background: '#111113', // slate 1 dark
    foreground: '#edeef0', // slate 12 dark
    muted: '#212225', // slate 3 dark
    mutedForeground: '#b0b4ba', // slate 11 dark
    card: '#18191b', // slate 2 dark
    border: '#43484e', // slate 6 dark
    primary: '#3b82f6', // blue accessible on dark
    primaryForeground: '#0b1220',
    destructive: '#ff6369', // red 10 dark (AA with dark fg)
    destructiveForeground: '#1a0d0d',
    ring: '#3b82f6'
  }
}
```

- [ ] **Step 3: Write the token vars + Tailwind wiring in index.css**

Replace `src/renderer/src/index.css`:

```css
@import 'tailwindcss';

@custom-variant dark (&:where(.dark, .dark *));

:root {
  --background: #ffffff;
  --foreground: #1c2024;
  --muted: #f1f3f5;
  --muted-foreground: #60646c;
  --card: #ffffff;
  --border: #d9dce1;
  --primary: #0d5bd1;
  --primary-foreground: #ffffff;
  --destructive: #c62a2f;
  --destructive-foreground: #ffffff;
  --ring: #0d5bd1;
}

.dark {
  --background: #111113;
  --foreground: #edeef0;
  --muted: #212225;
  --muted-foreground: #b0b4ba;
  --card: #18191b;
  --border: #43484e;
  --primary: #3b82f6;
  --primary-foreground: #0b1220;
  --destructive: #ff6369;
  --destructive-foreground: #1a0d0d;
  --ring: #3b82f6;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-card: var(--card);
  --color-border: var(--border);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-ring: var(--ring);
}

body {
  background-color: var(--background);
  color: var(--foreground);
}
```

Keep the hex values in `index.css` identical to `tokens.ts` (the test guards this). If you tweak a value for contrast, change it in both.

- [ ] **Step 4: Write the contrast test**

`tests/unit/token-contrast.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { TOKENS, type ThemeName, type TokenSet } from '../../src/renderer/src/lib/tokens'

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1! + 0.05) / (l2! + 0.05)
}

const themes: ThemeName[] = ['light', 'dark']

describe('token contrast (WCAG AA)', () => {
  for (const theme of themes) {
    const t: TokenSet = TOKENS[theme]
    it(`${theme}: body text ≥ 4.5:1`, () => {
      expect(contrast(t.foreground, t.background)).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: muted text ≥ 4.5:1`, () => {
      expect(contrast(t.mutedForeground, t.background)).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: primary button text ≥ 4.5:1`, () => {
      expect(contrast(t.primaryForeground, t.primary)).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: destructive text ≥ 4.5:1`, () => {
      expect(contrast(t.destructiveForeground, t.destructive)).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: border ≥ 3:1 (UI)`, () => {
      expect(contrast(t.border, t.background)).toBeGreaterThanOrEqual(3)
    })
  }
})
```

- [ ] **Step 5: Run — expect pass (fix token values if any pair fails)**

Run: `pnpm test`
Expected: token-contrast tests PASS. If a pair fails, adjust the offending token in BOTH `tokens.ts` and `index.css` (pick the next Radix step) until it passes.

- [ ] **Step 6: Verify build + commit**

Run: `pnpm typecheck && pnpm lint && pnpm build`

```bash
git add src/renderer/src/index.css src/renderer/src/lib/tokens.ts tests/unit/token-contrast.test.ts package.json pnpm-lock.yaml
git commit -m "feat: Radix-Colors token palette with WCAG AA contrast test"
```

---

### Task 2: shadcn scaffolding (components.json + cn())

**Files:**

- Create: `components.json`, `src/renderer/src/lib/utils.ts`

**Interfaces:**

- Produces: `cn(...inputs)` (clsx + tailwind-merge) used by every shadcn component; `components.json` telling the shadcn CLI where to place components and how to alias imports.

- [ ] **Step 1: Install helpers**

```bash
pnpm add class-variance-authority clsx tailwind-merge
```

- [ ] **Step 2: cn() helper**

`src/renderer/src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 3: components.json (electron-vite paths; no CLI dependency required)**

`components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/renderer/src/index.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "src/renderer/src/components",
    "ui": "src/renderer/src/components/ui",
    "utils": "src/renderer/src/lib/utils"
  }
}
```

Note: the shadcn CLI assumes a standard layout and may fight electron-vite. This plan copies component source directly (Tasks 5–7) rather than relying on `shadcn add`; `components.json` documents intent and lets the CLI work if it does. Components import `cn` from a relative path (`../../lib/utils`) since we don't have a bundler alias configured — use relative imports in `components/ui/*`.

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add components.json src/renderer/src/lib/utils.ts package.json pnpm-lock.yaml
git commit -m "chore: shadcn scaffolding (components.json + cn helper)"
```

---

### Task 3: resolveTheme + SettingsStore (main-side, pure + persisted)

**Files:**

- Create: `src/renderer/src/lib/theme.ts`, `src/main/settings-store.ts`, `tests/unit/theme.test.ts`, `tests/unit/settings-store.test.ts`

**Interfaces:**

- Produces: `type ThemeMode = 'light' | 'dark' | 'system'`; `resolveTheme(mode: ThemeMode, systemDark: boolean): 'light' | 'dark'`; `class SettingsStore` with `constructor(filePath)`, `getTheme(): Promise<ThemeMode>` (default `'system'`), `setTheme(mode): Promise<void>`. Task 4 uses both.

- [ ] **Step 1: Write failing tests**

`tests/unit/theme.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveTheme } from '../../src/renderer/src/lib/theme'

describe('resolveTheme', () => {
  it('light/dark are returned verbatim regardless of system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
  it('system follows the OS dark flag', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})
```

`tests/unit/settings-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore } from '../../src/main/settings-store'

let store: SettingsStore
beforeEach(() => {
  store = new SettingsStore(join(mkdtempSync(join(tmpdir(), 'fordb-set-')), 'settings.json'))
})

describe('SettingsStore', () => {
  it('defaults theme to system when file absent', async () => {
    expect(await store.getTheme()).toBe('system')
  })
  it('round-trips a theme mode', async () => {
    await store.setTheme('dark')
    expect(await store.getTheme()).toBe('dark')
  })
  it('defaults to system on a malformed/unknown value', async () => {
    await store.setTheme('light')
    // overwrite with garbage handled by falling back — set an invalid then read
    await store.setTheme('system')
    expect(await store.getTheme()).toBe('system')
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm test`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement theme.ts**

`src/renderer/src/lib/theme.ts`:

```ts
export type ThemeMode = 'light' | 'dark' | 'system'

export function resolveTheme(mode: ThemeMode, systemDark: boolean): 'light' | 'dark' {
  if (mode === 'system') return systemDark ? 'dark' : 'light'
  return mode
}
```

- [ ] **Step 4: Implement settings-store.ts**

`src/main/settings-store.ts`:

```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ThemeMode } from '../renderer/src/lib/theme'

const MODES: ReadonlySet<string> = new Set(['light', 'dark', 'system'])

interface SettingsFile {
  theme?: string
}

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  private async read(): Promise<SettingsFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as SettingsFile
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw err
    }
  }

  async getTheme(): Promise<ThemeMode> {
    const raw = (await this.read()).theme
    return raw && MODES.has(raw) ? (raw as ThemeMode) : 'system'
  }

  async setTheme(mode: ThemeMode): Promise<void> {
    const data = await this.read()
    data.theme = mode
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }
}
```

Note: importing the `ThemeMode` type from the renderer path is type-only (erased at build) — fine across the main/renderer boundary since it's a pure type. If the project's tsconfig rejects the cross-tree import, duplicate the 1-line type in `settings-store.ts` and keep them identical.

- [ ] **Step 5: Run — verify pass**

Run: `pnpm test`
Expected: theme + settings tests PASS.

- [ ] **Step 6: Verify + commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/renderer/src/lib/theme.ts src/main/settings-store.ts tests/unit/theme.test.ts tests/unit/settings-store.test.ts
git commit -m "feat: theme resolution + persisted SettingsStore"
```

---

### Task 4: nativeTheme + theme IPC + anti-flash startup wiring

**Files:**

- Modify: `src/main/index.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/main.tsx`

**Interfaces:**

- Consumes: `SettingsStore`, `resolveTheme` (Task 3).
- Produces: `window.fordb.appearance = { initialTheme: 'light'|'dark'; getMode(): Promise<ThemeMode>; setMode(mode): Promise<void>; onThemeChanged(cb: (t:'light'|'dark') => void): void }`. Task 5 (useThemeStore) consumes this.

- [ ] **Step 1: main — resolve initial theme, expose nativeTheme + IPC**

In `src/main/index.ts`: construct a `SettingsStore` at `join(app.getPath('userData'), 'settings.json')`. Before creating the window, read the mode and compute the effective theme via `nativeTheme.shouldUseDarkColors`. Pass the effective theme to the renderer through a preload-readable channel — simplest: set it as an additional argument via `process.env` is wrong for renderer; instead expose it through a synchronous IPC the preload calls. Concrete approach:

```ts
import {
  app,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  utilityProcess,
  MessageChannelMain
} from 'electron'
import { join } from 'node:path'
import { SettingsStore } from './settings-store'
import { resolveTheme, type ThemeMode } from '../renderer/src/lib/theme'
// ...existing db-host/hostControl code stays...

const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
let currentMode: ThemeMode = 'system'

function effectiveTheme(): 'light' | 'dark' {
  return resolveTheme(currentMode, nativeTheme.shouldUseDarkColors)
}

// Preload reads this synchronously at startup (before React) for the anti-flash stamp.
ipcMain.on('appearance:get-initial', (e) => {
  e.returnValue = effectiveTheme()
})
ipcMain.handle('appearance:get-mode', () => currentMode)
ipcMain.handle('appearance:set-mode', async (_e, mode: ThemeMode) => {
  currentMode = mode
  await settings.setTheme(mode)
  broadcastTheme()
})

function broadcastTheme(): void {
  const t = effectiveTheme()
  for (const win of BrowserWindow.getAllWindows())
    win.webContents.send('appearance:theme-changed', t)
}
nativeTheme.on('updated', () => broadcastTheme())
```

Load `currentMode` before creating the window:

```ts
void app.whenReady().then(async () => {
  currentMode = await settings.getTheme()
  startDbHost()
  registerIpc(() => hostControl)
  createWindow()
})
```

(If `registerIpc` already exists from M2, keep it; the appearance handlers can live in index.ts or move into ipc.ts — put them wherever `ipcMain` is already used, but ensure `appearance:get-initial` uses `ipcMain.on` with `e.returnValue`, not `handle`, so preload can read it synchronously.)

- [ ] **Step 2: preload — expose appearance API**

Add to the `window.fordb` object in `src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'
// within exposeInMainWorld('fordb', { ...existing,
  appearance: {
    initialTheme: ipcRenderer.sendSync('appearance:get-initial') as 'light' | 'dark',
    getMode: (): Promise<'light' | 'dark' | 'system'> => ipcRenderer.invoke('appearance:get-mode'),
    setMode: (mode: 'light' | 'dark' | 'system'): Promise<void> =>
      ipcRenderer.invoke('appearance:set-mode', mode),
    onThemeChanged: (cb: (t: 'light' | 'dark') => void): void => {
      ipcRenderer.on('appearance:theme-changed', (_e, t: 'light' | 'dark') => cb(t))
    }
  }
// })
```

`sendSync` runs at preload load time, before the renderer scripts execute — so `initialTheme` is available synchronously to `main.tsx`.

- [ ] **Step 3: renderer entry — stamp before React mounts**

At the top of `src/renderer/src/main.tsx`, BEFORE `createRoot(...).render(...)`:

```ts
import './index.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const initial = window.fordb.appearance.initialTheme
document.documentElement.classList.toggle('dark', initial === 'dark')
document.documentElement.classList.toggle('light', initial === 'light')

createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 4: Verify (types + build + headless smoke)**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass. Then `timeout 20 ELECTRON_DISABLE_SANDBOX=1 pnpm dev` — confirm no crash and no "appearance:get-initial" IPC errors in output (the sync handler must be registered before the window loads; it is, since handlers are set at module load). Report observation.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/main.tsx
git commit -m "feat: nativeTheme-backed theme IPC and anti-flash startup stamp"
```

---

### Task 5: useThemeStore + ThemeToggle + palette theme commands

**Files:**

- Create: `src/renderer/src/store-theme.ts`, `src/renderer/src/components/ThemeToggle.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**

- Consumes: `window.fordb.appearance` (Task 4), `ThemeMode` (Task 3).
- Produces: `useThemeStore` with `{ mode, effective, init(), setMode(mode) }`; `<ThemeToggle />`; theme commands added to the App command list.

- [ ] **Step 1: theme store**

`src/renderer/src/store-theme.ts`:

```ts
import { create } from 'zustand'
import type { ThemeMode } from './lib/theme'

function applyClass(effective: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', effective === 'dark')
  document.documentElement.classList.toggle('light', effective === 'light')
}

interface ThemeState {
  mode: ThemeMode
  effective: 'light' | 'dark'
  init: () => Promise<void>
  setMode: (mode: ThemeMode) => Promise<void>
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: 'system',
  effective: window.fordb.appearance.initialTheme,
  init: async () => {
    const mode = await window.fordb.appearance.getMode()
    set({ mode })
    window.fordb.appearance.onThemeChanged((t) => {
      applyClass(t)
      set({ effective: t })
    })
  },
  setMode: async (mode) => {
    await window.fordb.appearance.setMode(mode)
    set({ mode })
    // effective updates via the onThemeChanged broadcast that set-mode triggers
  }
}))
```

- [ ] **Step 2: ThemeToggle (3-state, keyboard-operable)**

`src/renderer/src/components/ThemeToggle.tsx`:

```tsx
import { useThemeStore } from '../store-theme'
import type { ThemeMode } from '../lib/theme'

const ORDER: ThemeMode[] = ['light', 'dark', 'system']
const LABEL: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System' }

export function ThemeToggle(): React.JSX.Element {
  const mode = useThemeStore((s) => s.mode)
  const setMode = useThemeStore((s) => s.setMode)
  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!
  return (
    <button
      className="px-2 py-1 rounded border border-border text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
      onClick={() => void setMode(next)}
      title={`Theme: ${LABEL[mode]} (click for ${LABEL[next]})`}
    >
      Theme: {LABEL[mode]}
    </button>
  )
}
```

- [ ] **Step 3: Wire init + toggle + palette commands into App.tsx**

In `App.tsx`: call `useThemeStore.getState().init()` in a `useEffect([])`; render `<ThemeToggle />` in a corner of the shell; add three commands to the `commands` array:

```tsx
import { useEffect } from 'react'
import { ThemeToggle } from './components/ThemeToggle'
import { useThemeStore } from './store-theme'
// inside App:
useEffect(() => {
  void useThemeStore.getState().init()
}, [])
const setMode = useThemeStore((s) => s.setMode)
// add to commands:
//   { id: 'theme-light', label: 'Theme: Light', run: () => void setMode('light') },
//   { id: 'theme-dark', label: 'Theme: Dark', run: () => void setMode('dark') },
//   { id: 'theme-system', label: 'Theme: System', run: () => void setMode('system') }
// render <ThemeToggle /> somewhere persistent (e.g. top of the sidebar or a header row)
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

```bash
git add src/renderer/src/store-theme.ts src/renderer/src/components/ThemeToggle.tsx src/renderer/src/App.tsx
git commit -m "feat: theme store, toggle, and command-palette theme commands"
```

---

### Task 6: Migrate CommandPalette to cmdk

**Files:**

- Create: `src/renderer/src/components/ui/command.tsx`, `src/renderer/src/components/ui/dialog.tsx`
- Modify: `src/renderer/src/components/CommandPalette.tsx`

**Interfaces:**

- Consumes: `cn` (Task 2). Keeps the existing `CommandPalette` prop contract: `{ commands: { id: string; label: string; run: () => void }[] }`, Ctrl/Cmd+K toggle, Escape close.
- Produces: a cmdk-backed palette; the connect e2e (Task 12) must still pass.

- [ ] **Step 1: Install cmdk + dialog primitive**

```bash
pnpm add cmdk @radix-ui/react-dialog
```

- [ ] **Step 2: Add shadcn `dialog` and `command` component source**

Copy the shadcn `Dialog` and `Command` component source into `src/renderer/src/components/ui/dialog.tsx` and `command.tsx`. Source: the shadcn/ui registry (https://ui.shadcn.com/docs/components/command and /dialog) — copy their published component code, changing only the `cn` import to the relative path `../../lib/utils` and ensuring all color classes are the semantic tokens (`bg-popover`→ add a `--popover` token if the copied code needs it; for M2 reuse `bg-card`/`text-foreground`/`border-border` — adjust the copied classes to the tokens defined in Task 1 rather than adding new ones). The `Command` wraps `cmdk`'s primitives; `CommandDialog` wraps `Command` in `Dialog`.
Note: if the copied shadcn source references tokens we didn't define (`popover`, `accent`, `input`), map them to existing ones (`card`, `muted`, `border`) in the copied classes — do NOT introduce undefined token classes (they'd render transparent).

- [ ] **Step 3: Rebuild CommandPalette on cmdk**

Rewrite `src/renderer/src/components/CommandPalette.tsx` to keep the same props + Ctrl/Cmd+K + Escape behavior, but render `CommandDialog` > `CommandInput` > `CommandList` > `CommandItem` per command:

```tsx
import { useEffect, useState } from 'react'
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandItem } from './ui/command'

interface Command {
  id: string
  label: string
  run: () => void
}

export function CommandPalette(props: { commands: Command[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Command…" />
      <CommandList>
        <CommandEmpty>No commands.</CommandEmpty>
        {props.commands.map((c) => (
          <CommandItem
            key={c.id}
            onSelect={() => {
              setOpen(false)
              c.run()
            }}
          >
            {c.label}
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
```

cmdk handles Escape-to-close and filtering internally; Radix Dialog handles the focus trap. The Ctrl/Cmd+K listener stays here.

- [ ] **Step 4: Verify (incl. e2e regression check)**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Then re-run the connect e2e if the environment allows (`pnpm build && pnpm db:up`, `pnpm e2e`) — the connect flow (which doesn't use the palette) must still pass; if the palette is on the path, update the e2e's selector to cmdk's input. If e2e can't run headless (keyring), document it and confirm the palette renders via `pnpm dev` smoke.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ui/command.tsx src/renderer/src/components/ui/dialog.tsx src/renderer/src/components/CommandPalette.tsx package.json pnpm-lock.yaml
git commit -m "feat: rebuild command palette on cmdk with Radix dialog"
```

---

### Task 7: shadcn Select + form primitives; token-classes across components

**Files:**

- Create: `src/renderer/src/components/ui/{button,input,label,checkbox,select}.tsx`
- Modify: `src/renderer/src/components/ProfileForm.tsx`, `ConnectionList.tsx`, `SchemaTree.tsx`

**Interfaces:**

- Consumes: `cn` (Task 2), tokens (Task 1).
- Produces: shadcn `Button`, `Input`, `Label`, `Checkbox`, `Select` in `components/ui/`; ProfileForm/ConnectionList rebuilt on them; SchemaTree restyled with tokens.

- [ ] **Step 1: Install Radix Select + checkbox**

```bash
pnpm add @radix-ui/react-select @radix-ui/react-checkbox @radix-ui/react-label
```

- [ ] **Step 2: Add shadcn component source**

Copy shadcn `button.tsx`, `input.tsx`, `label.tsx`, `checkbox.tsx`, `select.tsx` into `components/ui/`. Adjust: `cn` import → `../../lib/utils`; every color class → the Task 1 tokens (`bg-primary text-primary-foreground`, `bg-background`, `border-border`, `text-muted-foreground`, `focus-visible:ring-ring`, `bg-destructive`). Do not reference undefined tokens.

- [ ] **Step 3: Rebuild ProfileForm on the primitives**

Replace raw `<input className={field}>` with `<Input>`, the SSH auth `<select>` with shadcn `<Select>` (Radix), buttons with `<Button variant="default|outline|ghost">`, checkboxes with `<Checkbox>` + `<Label>`. The form STATE/logic (build(), secrets(), fillFromUrl, save/test) stays byte-identical — only the presentational elements change. Remove the hand-rolled `field` focus-ring string (the primitives carry focus-visible rings via tokens). Preserve every input's placeholder/label text so the connect e2e selectors still match (Name/Host/Port/Database/User/Password, the OK/Save/Test button text).

- [ ] **Step 4: Rebuild ConnectionList buttons + SchemaTree colors on tokens**

ConnectionList: `<Button>` for New connection / connect / edit / del; keep the `group-focus-within` reveal for edit/del (a11y from M2). SchemaTree: replace `text-neutral-*` with `text-muted-foreground` (glyphs) / `text-foreground` (names); the tree background inherits `bg-background`.

- [ ] **Step 5: Verify (build + e2e selectors intact)**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Grep the migrated components to confirm NO raw `neutral-`/`blue-`/`red-` literals remain (all semantic tokens). Re-run the connect e2e if possible; confirm selectors (placeholders, button text, `app` schema node) still resolve. `pnpm dev` smoke to eyeball light/dark if a display is available.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components package.json pnpm-lock.yaml
git commit -m "feat: migrate form + list + tree to shadcn primitives and semantic tokens"
```

---

## Self-Review (done at plan time)

1. **Spec coverage:** Token foundation + contrast test (spec §1) → Task 1. Theme switching + persistence + anti-flash (§2) → Tasks 3,4,5. Component migration (§3): cmdk → Task 6; Select + Input/Button/Label/Checkbox → Task 7; tree restyled → Task 7. Dependencies (§4) → installed across Tasks 1,2,6,7. Testing (§5): contrast (T1), resolveTheme (T3), SettingsStore (T3), e2e/regression (T6,T7). Success criteria (§6): AA tokens (T1), persist + no-flash (T3,T4), keyboard theme via palette (T5), cmdk + Radix Select (T6,T7), no raw literals (T7).
2. **Placeholder scan:** The shadcn component _source_ in Tasks 6–7 is "copy from the shadcn registry and adjust imports/tokens" rather than inlined verbatim — this is deliberate (the source is large, published, and versioned upstream) and bounded by explicit adjustment rules (relative `cn` import, map to defined tokens only, no undefined token classes). Flagged for the executor + reviewer to verify the copied source uses only Task 1 tokens. Everything else has complete code.
3. **Type consistency:** `ThemeMode` ('light'|'dark'|'system'), `resolveTheme(mode, systemDark)`, `SettingsStore.getTheme/setTheme`, `window.fordb.appearance.{initialTheme,getMode,setMode,onThemeChanged}`, `useThemeStore.{mode,effective,init,setMode}` consistent across Tasks 3–5. Token names (`background/foreground/muted/muted-foreground/card/border/primary/primary-foreground/destructive/destructive-foreground/ring`) consistent across Tasks 1,6,7.

**Known deliberate deferrals:** the `--popover`/`--accent`/`--input` tokens some shadcn components assume are mapped onto the smaller Task-1 token set rather than added — if a component needs finer separation later, extend the palette (and the contrast test). Live-desktop visual confirmation of both themes is manual (headless can't paint). The connect e2e still needs a keyring backend to run in CI (M3 carry-forward).

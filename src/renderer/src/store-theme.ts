import { create } from 'zustand'
import type { ThemeMode } from '../../shared/theme'

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

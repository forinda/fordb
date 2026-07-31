import { create } from 'zustand'
import type { ThemeMode } from '@shared/theme'
import { DEFAULT_EDITOR_THEME, isEditorThemeId, type EditorThemeId } from '@shared/editor-theme'

function applyClass(effective: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', effective === 'dark')
  document.documentElement.classList.toggle('light', effective === 'light')
}

interface ThemeState {
  mode: ThemeMode
  effective: 'light' | 'dark'
  /** Editor colour scheme, chosen independently of the app's light/dark mode. */
  editorTheme: EditorThemeId
  init: () => Promise<void>
  setMode: (mode: ThemeMode) => Promise<void>
  setEditorTheme: (id: EditorThemeId) => Promise<void>
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: 'system',
  effective: window.fordb.appearance.initialTheme,
  editorTheme: DEFAULT_EDITOR_THEME,
  init: async () => {
    const [mode, editorTheme] = await Promise.all([
      window.fordb.appearance.getMode(),
      window.fordb.appearance.getEditorTheme()
    ])
    set({ mode, editorTheme: isEditorThemeId(editorTheme) ? editorTheme : DEFAULT_EDITOR_THEME })
    window.fordb.appearance.onThemeChanged((t) => {
      applyClass(t)
      set({ effective: t })
    })
  },
  setEditorTheme: async (id) => {
    await window.fordb.appearance.setEditorTheme(id)
    set({ editorTheme: id })
  },
  setMode: async (mode) => {
    await window.fordb.appearance.setMode(mode)
    set({ mode })
    // effective updates via the onThemeChanged broadcast that set-mode triggers
  }
}))

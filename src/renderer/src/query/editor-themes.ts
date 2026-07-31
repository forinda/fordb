import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  dracula,
  githubDark,
  githubLight,
  gruvboxDark,
  materialDark,
  monokai,
  nord,
  solarizedLight,
  tokyoNight,
  vscodeDark,
  xcodeLight
} from '@uiw/codemirror-themes-all'
import type { EditorThemeId } from '@shared/editor-theme'
import { cmTheme, editorHighlight } from './cm-theme'

/** One entry in the editor-theme registry.
 *
 *  `appearance` is what the theme itself looks like, which is not necessarily
 *  the app's mode — someone can run a light UI with Monokai. It drives the
 *  swatch in the picker, not any behaviour. */
export interface EditorThemeDef {
  label: string
  appearance: 'light' | 'dark' | 'app'
  /** Resolved lazily so `app` can read the live app mode. */
  extension: (effective: 'light' | 'dark') => Extension
}

/** Adding a theme is one entry here plus one id in `EDITOR_THEMES`. The
 *  packaged themes carry their own surfaces *and* syntax colours, so picking
 *  Monokai gives the editor Monokai's background too — which is what choosing a
 *  code theme normally means. `app` instead uses fordb's own tokens so the
 *  editor stays visually part of the surrounding UI. */
export const EDITOR_THEME_REGISTRY: Record<EditorThemeId, EditorThemeDef> = {
  app: {
    label: 'Follow app theme',
    appearance: 'app',
    extension: (effective) => [cmTheme, editorHighlight(effective)]
  },
  monokai: { label: 'Monokai', appearance: 'dark', extension: () => monokai },
  dracula: { label: 'Dracula', appearance: 'dark', extension: () => dracula },
  nord: { label: 'Nord', appearance: 'dark', extension: () => nord },
  'tokyo-night': { label: 'Tokyo Night', appearance: 'dark', extension: () => tokyoNight },
  'gruvbox-dark': { label: 'Gruvbox Dark', appearance: 'dark', extension: () => gruvboxDark },
  'material-dark': { label: 'Material Dark', appearance: 'dark', extension: () => materialDark },
  'vscode-dark': { label: 'VS Code Dark', appearance: 'dark', extension: () => vscodeDark },
  'github-dark': { label: 'GitHub Dark', appearance: 'dark', extension: () => githubDark },
  'github-light': { label: 'GitHub Light', appearance: 'light', extension: () => githubLight },
  'solarized-light': {
    label: 'Solarized Light',
    appearance: 'light',
    extension: () => solarizedLight
  },
  'xcode-light': { label: 'Xcode Light', appearance: 'light', extension: () => xcodeLight }
}

/** Packaged themes style colours only — they don't set a height, so the editor
 *  would shrink-wrap its content and the pane would show the panel background
 *  below the last line. `cmTheme` carries `height: 100%` for the `app` theme;
 *  this supplies the same for the rest. */
const fillHeight = EditorView.theme({ '&': { height: '100%' } })

/** The extension set for a chosen theme. */
export function editorThemeExtension(id: EditorThemeId, effective: 'light' | 'dark'): Extension {
  const def = EDITOR_THEME_REGISTRY[id]
  const ext = def.extension(effective)
  return id === 'app' ? ext : [fillHeight, ext]
}

/** Editor colour schemes the SQL/JSON editors can use.
 *
 *  Separate from `ThemeMode` (the app chrome's light/dark/system): developers
 *  expect to pick a code theme independently of the surrounding UI, the way
 *  every code editor works. `app` is the default and means "follow the app
 *  theme", i.e. the token-driven surfaces the rest of fordb uses.
 *
 *  Lives in shared so main can validate the persisted value without importing
 *  renderer code — the id is written to settings.json and must survive a
 *  downgrade or a hand-edited file.
 */
export const EDITOR_THEMES = [
  'app',
  'monokai',
  'dracula',
  'nord',
  'tokyo-night',
  'gruvbox-dark',
  'material-dark',
  'vscode-dark',
  'github-dark',
  'github-light',
  'solarized-light',
  'xcode-light'
] as const

export type EditorThemeId = (typeof EDITOR_THEMES)[number]

export const DEFAULT_EDITOR_THEME: EditorThemeId = 'app'

export function isEditorThemeId(value: unknown): value is EditorThemeId {
  return typeof value === 'string' && (EDITOR_THEMES as readonly string[]).includes(value)
}

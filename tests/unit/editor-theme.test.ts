import { describe, it, expect } from 'vitest'
import { DEFAULT_EDITOR_THEME, EDITOR_THEMES, isEditorThemeId } from '../../src/shared/editor-theme'

// The registry in the renderer is typed `Record<EditorThemeId, EditorThemeDef>`,
// so a theme listed here without an entry is a compile error — no runtime test
// needed for completeness. What *can* drift is the persisted-value guard, which
// is the boundary between settings.json and the app.
describe('editor theme ids', () => {
  it('the default is a member of the list', () => {
    expect(EDITOR_THEMES).toContain(DEFAULT_EDITOR_THEME)
  })

  it('accepts every shipped id', () => {
    for (const id of EDITOR_THEMES) expect(isEditorThemeId(id)).toBe(true)
  })

  it('rejects unknown, removed, or malformed values', () => {
    // A hand-edited settings.json, or a theme dropped in a later version.
    expect(isEditorThemeId('solarized-dark')).toBe(false)
    expect(isEditorThemeId('')).toBe(false)
    expect(isEditorThemeId('Monokai')).toBe(false) // ids are lower-kebab
    expect(isEditorThemeId(undefined)).toBe(false)
    expect(isEditorThemeId(null)).toBe(false)
    expect(isEditorThemeId(42)).toBe(false)
    expect(isEditorThemeId({ id: 'monokai' })).toBe(false)
  })

  it('has no duplicate ids', () => {
    expect(new Set(EDITOR_THEMES).size).toBe(EDITOR_THEMES.length)
  })
})

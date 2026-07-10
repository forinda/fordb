import { describe, it, expect } from 'vitest'
import { dialectGlideTheme } from '../../src/renderer/src/query/glide-theme'

const VARS: Record<string, string> = {
  '--primary': '#2563eb',
  '--foreground': '#1a2740',
  '--muted-foreground': '#5b6f8c',
  '--faint': '#93a3bd',
  '--background': '#ffffff',
  '--surface-1': '#f8fafd',
  '--surface-2': '#f4f7fb',
  '--border-soft': '#e4eaf3'
}
const get = (v: string): string => VARS[v] ?? ''

describe('dialectGlideTheme', () => {
  const theme = dialectGlideTheme(get)
  it('maps token vars onto the Glide theme keys', () => {
    expect(theme.accentColor).toBe('#2563eb')
    expect(theme.textDark).toBe('#1a2740')
    expect(theme.bgCell).toBe('#ffffff')
    expect(theme.bgHeader).toBe('#f8fafd')
    expect(theme.borderColor).toBe('#e4eaf3')
  })
  it('sets the Dialect type scale + mono cell font', () => {
    expect(theme.headerFontStyle).toBe('600 11px')
    expect(theme.baseFontStyle).toBe('12px')
    expect(theme.fontFamily).toContain('ui-monospace')
  })
  it('derives the accent-light wash from the accent token', () => {
    expect(theme.accentLight).toContain('#2563eb')
  })
})

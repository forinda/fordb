import { describe, it, expect } from 'vitest'
import { resolveTheme } from '../../src/shared/theme'

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

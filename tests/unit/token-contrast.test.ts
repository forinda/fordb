import { describe, it, expect } from 'vitest'
import { TOKENS, type ThemeName, type TokenSet } from '../../src/shared/theme-tokens'

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
    // Borders here are decorative dividers (WCAG 1.4.11 exempts them when they
    // aren't the sole affordance). The perceivable UI-state indicator is the
    // focus ring — that's what must clear 3:1 against the background.
    it(`${theme}: focus ring ≥ 3:1 (UI)`, () => {
      expect(contrast(t.ring, t.background)).toBeGreaterThanOrEqual(3)
    })
  }
})

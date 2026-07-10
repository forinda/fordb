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

// Dialect design-system values (docs/specs/2026-07-10-dialect-p1-shell-tokens-design.md).
// Light is the mockup palette verbatim; dark is derived from its navy chrome.
// The token-contrast test enforces WCAG AA on every pair below.
export const TOKENS: Record<ThemeName, TokenSet> = {
  light: {
    background: '#ffffff',
    foreground: '#1a2740', // Dialect ink
    muted: '#f4f7fb', // surface-2
    mutedForeground: '#5b6f8c',
    card: '#ffffff',
    border: '#dbe3ef',
    primary: '#2563eb', // Dialect accent (AA with white text)
    primaryForeground: '#ffffff',
    destructive: '#c62a2f', // kept from Radix red 10
    destructiveForeground: '#ffffff',
    ring: '#2563eb'
  },
  dark: {
    background: '#0b1830', // navy chrome base
    foreground: '#e7eefc',
    muted: '#132741', // surface-2 dark
    mutedForeground: '#93a3bd',
    card: '#0f2140', // surface-1 dark
    border: '#33465f', // hairline on navy (decorative per contrast test)
    primary: '#5c9dff', // Dialect accent on dark
    primaryForeground: '#0b1220',
    destructive: '#ff6369', // kept (AA with dark fg)
    destructiveForeground: '#1a0d0d',
    ring: '#5c9dff'
  }
}

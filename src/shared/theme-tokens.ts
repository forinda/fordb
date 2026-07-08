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

import type { Theme } from '@glideapps/glide-data-grid'

export interface StyleGetter {
  (varName: string): string
}

/** Dialect theme for the Glide DataEditor, derived from the live CSS tokens
 *  so it tracks light/dark. Pure given a style getter (unit-testable). */
export function dialectGlideTheme(get: StyleGetter): Partial<Theme> {
  return {
    accentColor: get('--primary'),
    accentLight: `color-mix(in srgb, ${get('--primary')} 12%, transparent)`,
    textDark: get('--foreground'),
    textMedium: get('--muted-foreground'),
    textLight: get('--faint'),
    bgCell: get('--background'),
    bgHeader: get('--surface-1'),
    bgHeaderHovered: get('--surface-2'),
    bgHeaderHasFocus: get('--surface-2'),
    borderColor: get('--border-soft'),
    headerFontStyle: '600 11px',
    baseFontStyle: '12px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
  }
}

/** Reads the resolved token values off the document root (theme-class aware). */
export function liveStyleGetter(): StyleGetter {
  const cs = getComputedStyle(document.documentElement)
  return (v) => cs.getPropertyValue(v).trim()
}

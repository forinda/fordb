import type { Theme } from '@glideapps/glide-data-grid'

export interface StyleGetter {
  (varName: string): string
}

/** Dialect theme for the Glide DataEditor, derived from the live CSS tokens
 *  so it tracks light/dark. Pure given a style getter (unit-testable). */
/** #rrggbb → rgba(). Canvas2D fillStyle silently no-ops on color strings it
 *  can't parse (color-mix() support is not guaranteed there), so the accent
 *  wash ships as plain rgba. Non-hex input falls back to the raw string. */
function hexAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1]!, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export function dialectGlideTheme(get: StyleGetter): Partial<Theme> {
  return {
    accentColor: get('--primary'),
    accentLight: hexAlpha(get('--primary'), 0.12),
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

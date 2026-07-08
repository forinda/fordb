import { useThemeStore } from '../store-theme'
import type { ThemeMode } from '../../../shared/theme'

const ORDER: ThemeMode[] = ['light', 'dark', 'system']
const LABEL: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System' }

export function ThemeToggle(): React.JSX.Element {
  const mode = useThemeStore((s) => s.mode)
  const setMode = useThemeStore((s) => s.setMode)
  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!
  return (
    <button
      className="px-2 py-1 rounded border border-border text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
      onClick={() => void setMode(next)}
      title={`Theme: ${LABEL[mode]} (click for ${LABEL[next]})`}
    >
      Theme: {LABEL[mode]}
    </button>
  )
}

import { useEffect } from 'react'
import { useUiStore } from '../store-ui'

/** Transient run toast (Dialect). Auto-dismisses; re-arms per toast id. */
export function RunToast(): React.JSX.Element | null {
  const toast = useUiStore((s) => s.toast)
  const clear = useUiStore((s) => s.clearToast)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(clear, 3000)
    return () => clearTimeout(t)
  }, [toast, clear])
  if (!toast) return null
  return (
    <div className="pointer-events-none fixed bottom-8 left-1/2 z-[55] -translate-x-1/2">
      <div
        className={`pointer-events-auto flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs shadow-[var(--shadow-pop)] ${
          toast.kind === 'error'
            ? 'bg-destructive/10 text-destructive'
            : 'bg-card text-foreground-soft'
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${toast.kind === 'error' ? 'bg-destructive' : 'bg-success'}`}
        />
        {toast.message}
      </div>
    </div>
  )
}

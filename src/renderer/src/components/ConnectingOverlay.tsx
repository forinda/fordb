import { useUiStore } from '../store-ui'

/** Dialect connecting overlay: a centered card shown while a connection is
 *  being opened. The connect promise resolves fast for local DBs, so this is
 *  mostly a spinner for the slow/remote case. */
export function ConnectingOverlay(): React.JSX.Element | null {
  const connecting = useUiStore((s) => s.connecting)
  if (!connecting) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="flex w-72 flex-col items-center gap-3 rounded-2xl bg-card p-6 text-center shadow-[var(--shadow-modal)]">
        <span
          className="h-9 w-9 animate-spin rounded-full border-2 border-primary/25 border-t-primary"
          aria-hidden="true"
        />
        <div className="text-sm font-semibold text-foreground">
          Connecting to {connecting.label}
        </div>
        <div className="font-mono text-xs text-muted-foreground">{connecting.host}</div>
      </div>
    </div>
  )
}

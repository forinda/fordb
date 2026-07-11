import type { ReactNode } from 'react'
import { useUpdaterStore } from '../store-updater'
import { bannerVisible } from '@shared/updater'

export function UpdateBanner(): ReactNode {
  const status = useUpdaterStore((s) => s.status)
  const dismissed = useUpdaterStore((s) => s.dismissed)
  const dismiss = useUpdaterStore((s) => s.dismiss)
  if (dismissed || status.status === 'idle') return null

  const line = (text: string, action?: ReactNode): ReactNode => (
    <div className="flex items-center justify-center gap-3 border-b border-border bg-surface-2 px-3 py-1 text-xs">
      <span>{text}</span>
      {action}
      <button className="text-faint hover:text-foreground" onClick={dismiss} aria-label="dismiss">
        ✕
      </button>
    </div>
  )

  if (bannerVisible(status))
    return line(
      `Update v${status.version} ready.`,
      <button
        className="rounded bg-primary px-2 py-0.5 text-primary-foreground"
        onClick={() => void window.fordb.updater.install()}
      >
        Restart to update
      </button>
    )
  if (status.status === 'checking') return line('Checking for updates…')
  if (status.status === 'downloading') return line(`Downloading update… ${status.percent}%`)
  if (status.status === 'available') return line(`Update v${status.version} found — downloading…`)
  if (status.status === 'not-available') return line("You're on the latest version.")
  if (status.status === 'unsupported')
    return line('Auto-update is unavailable for this install — use apt/dnf or the Releases page.')
  if (status.status === 'error') return line(`Update check failed: ${status.message}`)
  return null
}

import { useEffect, useRef, type ReactNode } from 'react'
import IconX from '~icons/lucide/x'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ open, onClose, title, children, footer }: ModalProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      // Trap Tab within the dialog: wrap focus at the ends, and pull focus in
      // if it has escaped the panel entirely.
      if (e.key !== 'Tab' || !panel.current) return
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      const inside = panel.current.contains(active)
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[85vh] w-[720px] max-w-[92vw] flex-col rounded-lg border border-border bg-background shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Escape and click-away already closed the dialog, but nothing said so
            — there was no visible way out, which reads as a trap. A close
            button plus the Esc hint states both routes. */}
        <div className="flex flex-none items-center gap-2 border-b border-border py-1.5 pl-3 pr-1.5">
          <h2 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </h2>
          <span
            aria-hidden="true"
            className="flex-none rounded border border-border bg-surface-2 px-1 text-[10px] text-muted-foreground"
          >
            Esc
          </span>
          <button
            aria-label="Close"
            title="Close"
            onClick={onClose}
            className="flex-none rounded p-1 text-muted-foreground hover:bg-surface-2 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

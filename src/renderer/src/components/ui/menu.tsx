import { useState, type ReactNode } from 'react'
import { Popover } from 'radix-ui'

/** Anchored dropdown menu.
 *
 *  Radix Popover rather than an absolutely-positioned div: these menus live in
 *  the sidebar, which sits inside a resizable panel under an `overflow-hidden`
 *  app root, so an inline dropdown is clipped at the panel edge — the sidebar's
 *  connection switcher was being cut off by the main pane. Popover portals to
 *  the body and flips/shifts to stay on screen. */
export function Menu(props: {
  /** Rendered inside the trigger button. */
  trigger: ReactNode
  /** Accessible name for the trigger. */
  ariaLabel: string
  title?: string
  align?: 'start' | 'end'
  disabled?: boolean
  className?: string
  /** Caps the list height; long lists scroll inside the popover. */
  maxHeightRem?: number
  children: (close: () => void) => ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const max = props.maxHeightRem ?? 20

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={props.ariaLabel}
        title={props.title}
        disabled={props.disabled}
        className={props.className}
      >
        {props.trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={props.align ?? 'start'}
          sideOffset={4}
          className="z-50 min-w-56 overflow-hidden rounded-lg border border-border bg-background py-1 text-sm shadow-[var(--shadow-pop)]"
          style={{
            maxHeight: `min(${max}rem, var(--radix-popover-content-available-height))`,
            overflowY: 'auto'
          }}
        >
          {props.children(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** A row inside a `Menu`.
 *
 *  Deliberately a plain button, not `role="menuitem"`: that role is only valid
 *  inside a `role="menu"` container, and Radix Popover provides no menu
 *  keyboard semantics (arrow-key roving, type-ahead). Claiming the role would
 *  promise behaviour we don't implement; a list of buttons is honest and Tab
 *  reaches every one of them. */
export function MenuItem(props: {
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-foreground hover:bg-muted focus:outline-none focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50"
    >
      {props.children}
    </button>
  )
}

export function MenuSeparator(): React.JSX.Element {
  return <div className="my-1 border-t border-border" />
}

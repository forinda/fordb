import { useState } from 'react'
import { Popover } from 'radix-ui'
import IconChevron from '~icons/lucide/chevrons-up-down'
import IconCheck from '~icons/lucide/check'
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from './command'

/** A searchable single-select: a trigger showing the current value, and a
 *  popover with a filter box over the options.
 *
 *  A native `<select>` is fine for a handful of options but degrades past a few
 *  dozen — no filtering, and the OS dropdown can't be styled or scrolled on our
 *  terms. Built on the same cmdk primitives as the ⌘K palette, so filtering and
 *  arrow-key/Enter behaviour match it.
 *
 *  Radix Popover (not absolute positioning) because this renders inside a
 *  resizable sidebar panel under an `overflow-hidden` app root — an inline
 *  dropdown gets clipped. Popover portals to the body and flips/shifts to stay
 *  on screen. */
export function Combobox(props: {
  value: string
  options: string[]
  onChange: (value: string) => void
  /** Accessible name for the trigger. */
  ariaLabel: string
  placeholder?: string
  /** Shown when the list is empty after filtering. */
  emptyText?: string
  disabled?: boolean
  className?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={props.ariaLabel}
        disabled={props.disabled}
        className={`flex w-full min-w-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground hover:border-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${props.className ?? ''}`}
      >
        <span className="min-w-0 flex-1 truncate text-left">{props.value}</span>
        <IconChevron className="h-3 w-3 flex-none text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          // Match the trigger's width but never go narrower than readable, and
          // cap height so long database lists scroll inside the popover rather
          // than running off the window.
          className="z-50 w-[max(var(--radix-popover-trigger-width),16rem)] overflow-hidden rounded-lg border border-border bg-background shadow-[var(--shadow-pop)]"
        >
          <Command>
            <CommandInput placeholder={props.placeholder ?? 'Search…'} />
            <CommandList className="max-h-[min(18rem,var(--radix-popover-content-available-height))]">
              <CommandEmpty>{props.emptyText ?? 'No matches.'}</CommandEmpty>
              {props.options.map((opt) => (
                <CommandItem
                  key={opt}
                  value={opt}
                  onSelect={() => {
                    setOpen(false)
                    if (opt !== props.value) props.onChange(opt)
                  }}
                  className="flex items-center gap-2 py-1.5"
                >
                  <span className="w-3.5 flex-none">
                    {opt === props.value && <IconCheck className="h-3.5 w-3.5 text-primary" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{opt}</span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

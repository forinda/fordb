import { Command as CommandPrimitive } from 'cmdk'
import * as Dialog from '@radix-ui/react-dialog'
import { cn } from '../../lib/utils'

// Token-styled wrappers around cmdk (+ Radix Dialog for the overlay). Adapted
// from shadcn/ui's Command component to fordb's semantic tokens.

export function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>): React.JSX.Element {
  return (
    <CommandPrimitive
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-md text-foreground',
        className
      )}
      {...props}
    />
  )
}

export function CommandDialog({
  open,
  onOpenChange,
  children
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-32 w-96 -translate-x-1/2 overflow-hidden rounded-md border border-border bg-card shadow-lg"
          aria-label="Command palette"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Command>{children}</Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>): React.JSX.Element {
  return (
    <CommandPrimitive.Input
      className={cn(
        'w-full bg-transparent px-3 py-2 text-foreground placeholder-muted-foreground outline-none border-b border-border',
        className
      )}
      {...props}
    />
  )
}

export function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>): React.JSX.Element {
  return (
    <CommandPrimitive.List className={cn('max-h-64 overflow-auto p-1', className)} {...props} />
  )
}

export function CommandEmpty(
  props: React.ComponentProps<typeof CommandPrimitive.Empty>
): React.JSX.Element {
  return <CommandPrimitive.Empty className="px-3 py-2 text-sm text-muted-foreground" {...props} />
}

export function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>): React.JSX.Element {
  return (
    <CommandPrimitive.Item
      className={cn(
        'cursor-default rounded px-3 py-2 text-sm text-foreground data-[selected=true]:bg-muted',
        className
      )}
      {...props}
    />
  )
}

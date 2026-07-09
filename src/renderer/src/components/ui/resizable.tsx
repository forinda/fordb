import * as ResizablePrimitive from 'react-resizable-panels'
import IconGrip from '~icons/lucide/grip-vertical'
import { cn } from '../../lib/utils'

// Thin shadcn-style wrapper over react-resizable-panels. PanelGroup lays panels
// out along one axis; Handle is the draggable divider (optional grip glyph).
export function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>): React.JSX.Element {
  return (
    <ResizablePrimitive.PanelGroup
      className={cn('flex h-full w-full data-[panel-group-direction=vertical]:flex-col', className)}
      {...props}
    />
  )
}

export const ResizablePanel = ResizablePrimitive.Panel

export function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean
}): React.JSX.Element {
  return (
    <ResizablePrimitive.PanelResizeHandle
      className={cn(
        'relative flex w-px items-center justify-center bg-border transition-colors hover:bg-primary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        // Vertical groups: the handle is a horizontal bar.
        'data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full',
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground data-[panel-group-direction=vertical]:rotate-90">
          <IconGrip className="h-2.5 w-2.5" />
        </div>
      )}
    </ResizablePrimitive.PanelResizeHandle>
  )
}

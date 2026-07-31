import { Label as LabelPrimitive } from 'radix-ui'
import { cn } from '../../lib/utils'

export function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>): React.JSX.Element {
  return (
    <LabelPrimitive.Root
      className={cn('flex items-center gap-2 text-sm text-foreground', className)}
      {...props}
    />
  )
}

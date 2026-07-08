import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { cn } from '../../lib/utils'

export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>): React.JSX.Element {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'h-4 w-4 shrink-0 rounded border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-xs leading-none">
        ✓
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

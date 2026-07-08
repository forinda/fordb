import { cn } from '../../lib/utils'

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      className={cn(
        'w-full rounded border border-border bg-background px-2 py-1 text-foreground placeholder-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
      {...props}
    />
  )
}

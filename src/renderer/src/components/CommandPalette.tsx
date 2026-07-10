import { useEffect, useState } from 'react'
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandItem } from './ui/command'

interface Command {
  id: string
  label: string
  run: () => void
}

export function CommandPalette(props: { commands: Command[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    // The sidebar's search row (and anything else) can toggle the palette
    // without synthesizing keystrokes.
    function onToggle(): void {
      setOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('fordb:palette-toggle', onToggle)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('fordb:palette-toggle', onToggle)
    }
  }, [])
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Command…" />
      <CommandList>
        <CommandEmpty>No commands.</CommandEmpty>
        {props.commands.map((c) => (
          <CommandItem
            key={c.id}
            onSelect={() => {
              setOpen(false)
              c.run()
            }}
          >
            {c.label}
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  )
}

import { useEffect, useState } from 'react'
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandItem } from './ui/command'
import { useProfiles } from '../query/profiles'
import { connectionLabel } from '@shared/connection-label'
import { EngineGlyph, profileAddress } from './ConnectionManager'

interface Command {
  id: string
  label: string
  run: () => void
}

/** ⌘K palette: jump to a saved connection (connect on select) or run a
 *  command. Matches the Dialect "jump to a connection, table or collection"
 *  design; table/collection jump is a later addition. */
export function CommandPalette(props: {
  commands: Command[]
  onConnect: (connectionId: string, profileId: string, database: string | null) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { data: profiles = [] } = useProfiles()

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
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

  async function jumpConnect(id: string): Promise<void> {
    setOpen(false)
    const p = profiles.find((x) => x.id === id)
    if (!p) return
    const connectionId = await window.fordb.connection.open(id)
    props.onConnect(connectionId, id, p.engine === 'postgres' ? p.database : null)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to a connection, table or collection…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        {profiles.map((p) => (
          <CommandItem
            key={`conn:${p.id}`}
            value={`${connectionLabel(p)} ${p.engine} ${profileAddress(p)}`}
            onSelect={() => void jumpConnect(p.id)}
          >
            <EngineGlyph engine={p.engine} />
            <span className="ml-2 flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">{connectionLabel(p)}</span>
              <span className="truncate text-xs text-muted-foreground">
                {p.engine} · {profileAddress(p)}
              </span>
            </span>
            <span className="ml-2 text-[10px] font-semibold uppercase text-faint">Connection</span>
          </CommandItem>
        ))}
        {props.commands.map((c) => (
          <CommandItem
            key={c.id}
            value={c.label}
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

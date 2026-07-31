import { useEffect, useState } from 'react'
import { defaultFilter } from 'cmdk'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem
} from './ui/command'
import { useProfiles } from '../query/profiles'
import { connectionLabel } from '@shared/connection-label'
import { EngineGlyph, profileAddress } from './ConnectionManager'

export interface Command {
  id: string
  label: string
  run: () => void
  /** Heading to cluster under, VS Code style ("View", "Query", …). */
  group?: string
  /** Only set where a real key binding exists — an invented hint is worse than
   *  none, because people trust it and then it doesn't work. */
  shortcut?: string
}

/** Command palette.
 *
 *  Two modes, like VS Code: the default lists everything you can jump to, and a
 *  leading `>` narrows to commands only. ⌘K / Ctrl K opens the first, ⌘⇧P /
 *  Ctrl ⇧P opens straight into the second — so the muscle memory from an editor
 *  works here.
 *
 *  Results are grouped under headings rather than being one flat list, which is
 *  what made the old palette hard to scan once there were a dozen commands and
 *  every saved connection in the same run. */
export function CommandPalette(props: {
  commands: Command[]
  onConnect: (connectionId: string, profileId: string, database: string | null) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { data: profiles = [] } = useProfiles()

  const commandMode = search.startsWith('>')

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setSearch('>')
        setOpen(true)
        return
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearch('')
        setOpen((v) => !v)
      }
    }
    function onToggle(): void {
      setSearch('')
      setOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('fordb:palette-toggle', onToggle)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('fordb:palette-toggle', onToggle)
    }
  }, [])

  function close(): void {
    setOpen(false)
    setSearch('')
  }

  async function jumpConnect(id: string): Promise<void> {
    close()
    const p = profiles.find((x) => x.id === id)
    if (!p) return
    const connectionId = await window.fordb.connection.open(id)
    props.onConnect(connectionId, id, p.engine === 'postgres' ? p.database : null)
  }

  // Preserve the order App declares commands in, but cluster by heading.
  const groups = new Map<string, Command[]>()
  for (const c of props.commands) {
    const key = c.group ?? 'Commands'
    const list = groups.get(key)
    if (list) list.push(c)
    else groups.set(key, [c])
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(v) => (v ? setOpen(true) : close())}
      // The `>` stays visible in the input (VS Code keeps it), so strip it
      // before scoring or every item would be matched against the sigil.
      // Delegates to cmdk's own fuzzy matcher rather than reimplementing it.
      filter={(value, s, keywords) =>
        defaultFilter!(value, s.startsWith('>') ? s.slice(1).trimStart() : s, keywords)
      }
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder={
          commandMode ? 'Run a command…' : 'Jump to a connection, or type > for commands…'
        }
      />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        {!commandMode && profiles.length > 0 && (
          <CommandGroup heading="Connections">
            {profiles.map((p) => (
              <CommandItem
                key={`conn:${p.id}`}
                value={`${connectionLabel(p)} ${p.engine} ${profileAddress(p)}`}
                onSelect={() => void jumpConnect(p.id)}
                className="flex items-center"
              >
                <EngineGlyph engine={p.engine} />
                <span className="ml-2 flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{connectionLabel(p)}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {p.engine} · {profileAddress(p)}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {[...groups].map(([heading, list]) => (
          <CommandGroup key={heading} heading={heading}>
            {list.map((c) => (
              <CommandItem
                key={c.id}
                // Include the heading so "view sidebar" finds "Toggle sidebar"
                // under View, the way VS Code matches "Category: Command".
                value={`${heading} ${c.label}`}
                onSelect={() => {
                  close()
                  c.run()
                }}
                className="flex items-center gap-2"
              >
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.shortcut && (
                  <span className="flex-none rounded border border-border bg-surface-2 px-1 text-[10px] text-muted-foreground">
                    {c.shortcut}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}

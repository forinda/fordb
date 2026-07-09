import { useState } from 'react'
import IconPlugConnected from '~icons/lucide/plug-zap'
import type { ConnectionProfile } from '@shared/adapter/types'
import { connectionLabel } from '@shared/connection-label'
import { useProfiles, useInvalidateProfiles } from '../query/profiles'
import { useConnStore } from '../store'
import { Button } from './ui/button'

export function ConnectionList(props: {
  onConnect: (connectionId: string, profileId: string, database: string | null) => void
  onEdit: (profile: ConnectionProfile) => void
  onNew: () => void
}): React.JSX.Element {
  const { data: profiles = [] } = useProfiles()
  const invalidateProfiles = useInvalidateProfiles()
  const activeProfileId = useConnStore((s) => s.activeProfileId)
  // Which profile is mid-connect, and the last connect error — so clicking a
  // row gives immediate feedback and a failed open isn't silently swallowed.
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)

  async function connect(id: string): Promise<void> {
    if (connectingId) return // ignore double-clicks while a connect is in flight
    setConnectingId(id)
    setConnectError(null)
    try {
      const connectionId = await window.fordb.connection.open(id)
      const p = profiles.find((x) => x.id === id)
      props.onConnect(connectionId, id, p?.engine === 'postgres' ? p.database : null)
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnectingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-1 p-2 max-h-64 overflow-auto shrink-0">
      <Button className="text-left mb-2" onClick={props.onNew}>
        + New connection
      </Button>
      {connectError && <div className="px-2 py-1 text-xs text-destructive">{connectError}</div>}
      {profiles.map((p) => {
        const isActive = p.id === activeProfileId
        return (
          <div
            key={p.id}
            className={`group flex items-center justify-between px-2 py-1 rounded focus-within:bg-muted ${
              isActive ? 'bg-muted' : 'hover:bg-muted'
            }`}
          >
            <button
              className="flex flex-1 items-center gap-1 text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
              disabled={connectingId !== null}
              onClick={() => void connect(p.id)}
            >
              {isActive && (
                <IconPlugConnected
                  className="h-3.5 w-3.5 shrink-0 text-primary"
                  aria-label="connected"
                />
              )}
              <span className={isActive ? 'text-primary' : 'text-foreground'}>
                {connectionLabel(p)}
              </span>
              {connectingId === p.id && (
                <span className="ml-2 text-xs text-muted-foreground">connecting…</span>
              )}
            </button>
            {/* Revealed on hover OR keyboard focus within the row, so keyboard users can reach them. */}
            <button
              className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-xs px-1 text-muted-foreground rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => props.onEdit(p)}
            >
              edit
            </button>
            <button
              className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-xs px-1 text-muted-foreground rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                void window.fordb.profiles.delete(p.id).then(() => invalidateProfiles())
              }}
            >
              del
            </button>
          </div>
        )
      })}
    </div>
  )
}

import { useEffect } from 'react'
import { useConnStore } from '../store'
import type { ConnectionProfile } from '@shared/adapter/types'
import { connectionLabel } from '@shared/connection-label'
import { Button } from './ui/button'

export function ConnectionList(props: {
  onConnect: (connectionId: string, profileId: string) => void
  onEdit: (profile: ConnectionProfile) => void
  onNew: () => void
}): React.JSX.Element {
  const profiles = useConnStore((s) => s.profiles)
  const load = useConnStore((s) => s.loadProfiles)
  useEffect(() => {
    void load()
  }, [load])

  async function connect(id: string): Promise<void> {
    const connectionId = await window.fordb.connection.open(id)
    props.onConnect(connectionId, id)
  }

  return (
    <div className="flex flex-col gap-1 p-2 max-h-64 overflow-auto shrink-0">
      <Button className="text-left mb-2" onClick={props.onNew}>
        + New connection
      </Button>
      {profiles.map((p) => (
        <div
          key={p.id}
          className="group flex items-center justify-between px-2 py-1 rounded hover:bg-muted focus-within:bg-muted"
        >
          <button
            className="text-left flex-1 text-foreground rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void connect(p.id)}
          >
            {connectionLabel(p)}
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
              void window.fordb.profiles
                .delete(p.id)
                .then(() => useConnStore.getState().loadProfiles())
            }}
          >
            del
          </button>
        </div>
      ))}
    </div>
  )
}

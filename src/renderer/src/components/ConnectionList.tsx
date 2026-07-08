import { useEffect } from 'react'
import { useConnStore } from '../store'
import type { ConnectionProfile } from '../../../shared/adapter/types'

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
    <div className="flex flex-col gap-1 p-2 w-64 border-r border-neutral-800 h-full">
      <button
        className="text-left px-2 py-1 rounded bg-blue-700 text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 mb-2"
        onClick={props.onNew}
      >
        + New connection
      </button>
      {profiles.map((p) => (
        <div
          key={p.id}
          className="group flex items-center justify-between px-2 py-1 rounded hover:bg-neutral-800 focus-within:bg-neutral-800"
        >
          <button
            className="text-left flex-1 text-neutral-100 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
            onClick={() => void connect(p.id)}
          >
            {p.name}
          </button>
          {/* Revealed on hover OR keyboard focus within the row, so keyboard users can reach them. */}
          <button
            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-xs px-1 text-neutral-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
            onClick={() => props.onEdit(p)}
          >
            edit
          </button>
          <button
            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-xs px-1 text-neutral-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
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

import { useState } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { ConnectionList } from './components/ConnectionList'
import { ProfileForm } from './components/ProfileForm'
import { SchemaTree } from './components/SchemaTree'
import { useConnStore } from './store'
import type { ConnectionProfile } from '../../shared/adapter/types'
// The global `Window.fordb` type is declared once in ./rpc.ts (imported for
// its ambient `declare global` augmentation).
import './rpc'

type View =
  { kind: 'welcome' } | { kind: 'form'; profile?: ConnectionProfile } | { kind: 'connected' }

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>({ kind: 'welcome' })
  const setActive = useConnStore((s) => s.setActive)
  const clearActive = useConnStore((s) => s.clearActive)
  const activeConnectionId = useConnStore((s) => s.activeConnectionId)

  const commands = [
    { id: 'new', label: 'New connection', run: () => setView({ kind: 'form' }) },
    {
      id: 'disconnect',
      label: 'Disconnect',
      run: () => {
        if (activeConnectionId) void window.fordb.connection.close(activeConnectionId)
        clearActive()
        setView({ kind: 'welcome' })
      }
    }
  ]

  return (
    <div className="flex h-screen text-neutral-100 bg-neutral-950">
      <ConnectionList
        onNew={() => setView({ kind: 'form' })}
        onEdit={(profile) => setView({ kind: 'form', profile })}
        onConnect={(connectionId, profileId) => {
          setActive(connectionId, profileId)
          setView({ kind: 'connected' })
        }}
      />
      <div className="flex-1 overflow-auto">
        {view.kind === 'welcome' && (
          <div className="p-6 text-neutral-400">Select or create a connection.</div>
        )}
        {view.kind === 'form' && (
          <ProfileForm
            profile={view.profile}
            onSaved={() => setView({ kind: 'welcome' })}
            onCancel={() => setView({ kind: 'welcome' })}
          />
        )}
        {view.kind === 'connected' && <SchemaTree />}
      </div>
      <CommandPalette commands={commands} />
    </div>
  )
}

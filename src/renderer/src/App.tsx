import { useEffect, useState } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { ConnectionList } from './components/ConnectionList'
import { ProfileForm } from './components/ProfileForm'
import { SchemaTree } from './components/SchemaTree'
import { RefreshSchemaButton } from './components/RefreshSchemaButton'
import { ThemeToggle } from './components/ThemeToggle'
import { QueryWorkbench } from './components/QueryWorkbench'
import { ServerDashboard } from './components/ServerDashboard'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './components/ui/resizable'
import { queryClient } from './query/client'
import { invalidateIntrospection } from './query/introspection'
import { useConnStore } from './store'
import { useThemeStore } from './store-theme'
import { useQueryStore } from './store-query'
import type { ConnectionProfile } from '@shared/adapter/types'
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
  const setMode = useThemeStore((s) => s.setMode)
  const mainView = useQueryStore((s) => s.mainView)
  const setMainView = useQueryStore((s) => s.setMainView)

  useEffect(() => {
    void useThemeStore.getState().init()
    window.fordb.onDbHostRestarted(() => useQueryStore.getState().connectionLost())
  }, [])

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
    },
    {
      id: 'run-query',
      label: 'Run query',
      run: () => {
        const s = useQueryStore.getState()
        if (s.activeTabId) void s.run(s.activeTabId)
      }
    },
    {
      id: 'cancel-query',
      label: 'Cancel query',
      run: () => {
        const s = useQueryStore.getState()
        if (s.activeTabId) void s.cancel(s.activeTabId)
      }
    },
    { id: 'new-query-tab', label: 'New query tab', run: () => useQueryStore.getState().newTab() },
    { id: 'show-dashboard', label: 'Show dashboard', run: () => setMainView('dashboard') },
    { id: 'show-query', label: 'Show query', run: () => setMainView('query') },
    {
      id: 'refresh-schema',
      label: 'Refresh schema',
      run: () => {
        if (activeConnectionId) void invalidateIntrospection(queryClient, activeConnectionId)
      }
    },
    { id: 'theme-light', label: 'Theme: Light', run: () => void setMode('light') },
    { id: 'theme-dark', label: 'Theme: Dark', run: () => void setMode('dark') },
    { id: 'theme-system', label: 'Theme: System', run: () => void setMode('system') }
  ]

  return (
    <div className="h-screen text-foreground bg-background">
      <ResizablePanelGroup direction="horizontal">
        {/* One unified left sidebar: connections on top, the active connection's
            schema tree below, theme toggle pinned at the bottom. */}
        <ResizablePanel defaultSize={18} minSize={12} maxSize={40} className="flex flex-col">
          <ConnectionList
            onNew={() => setView({ kind: 'form' })}
            onEdit={(profile) => setView({ kind: 'form', profile })}
            onConnect={(connectionId, profileId) => {
              setActive(connectionId, profileId)
              setView({ kind: 'connected' })
            }}
          />
          {view.kind === 'connected' && (
            <div className="flex-1 min-h-0 flex flex-col border-t border-border">
              <div className="flex justify-end px-2 py-1 border-b border-border">
                <RefreshSchemaButton />
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                <SchemaTree />
              </div>
            </div>
          )}
          <div className="p-2 border-t border-border">
            <ThemeToggle />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel className="min-w-0">
          <div className="h-full overflow-auto">
            {view.kind === 'welcome' && (
              <div className="p-6 text-muted-foreground">Select or create a connection.</div>
            )}
            {view.kind === 'form' && (
              <ProfileForm
                profile={view.profile}
                onSaved={() => setView({ kind: 'welcome' })}
                onCancel={() => setView({ kind: 'welcome' })}
              />
            )}
            {view.kind === 'connected' && (
              <div className="flex h-full flex-col">
                <div className="flex gap-1 border-b border-border p-1">
                  <button
                    className={`rounded px-2 py-0.5 text-sm ${mainView === 'query' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                    onClick={() => setMainView('query')}
                  >
                    Query
                  </button>
                  <button
                    className={`rounded px-2 py-0.5 text-sm ${mainView === 'dashboard' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                    onClick={() => setMainView('dashboard')}
                  >
                    Dashboard
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  {mainView === 'query' ? <QueryWorkbench /> : <ServerDashboard />}
                </div>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      <CommandPalette commands={commands} />
    </div>
  )
}

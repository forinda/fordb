import { useEffect, useState } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { ConnectionList } from './components/ConnectionList'
import { ProfileForm } from './components/ProfileForm'
import { SchemaTree } from './components/SchemaTree'
import { RefreshSchemaButton } from './components/RefreshSchemaButton'
import { DatabaseSwitcher } from './components/DatabaseSwitcher'
import { TitleBar } from './components/TitleBar'
import { StatusBar } from './components/StatusBar'
import { QueryWorkbench } from './components/QueryWorkbench'
import { QueryLibrary } from './components/QueryLibrary'
import { CsvImportDialog } from './components/CsvImportDialog'
import { ActiveConnectionBar } from './components/ActiveConnectionBar'
import { ServerDashboard } from './components/ServerDashboard'
import { MongoDashboard } from './components/MongoDashboard'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './components/ui/resizable'
import { queryClient } from './query/client'
import { invalidateIntrospection } from './query/introspection'
import { useServerStatsSupported } from './query/stats'
import { useMongoStatsSupported } from './query/mongo-stats'
import { useConnStore } from './store'
import { useThemeStore } from './store-theme'
import { useQueryStore } from './store-query'
import { useDialect } from './query/use-dialect'
import { useDocumentQuerySupported } from './query/documents'
import type { ConnectionProfile } from '@shared/adapter/types'
// The global `Window.fordb` type is declared once in ./rpc.ts (imported for
// its ambient `declare global` augmentation).
import './rpc'

type View =
  { kind: 'welcome' } | { kind: 'form'; profile?: ConnectionProfile } | { kind: 'connected' }

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>({ kind: 'welcome' })
  // When connected, whether the connection list is revealed (to switch) over the
  // schema tree. Collapsed by default so the active connection gets the room.
  const [showConnList, setShowConnList] = useState(false)
  const setActive = useConnStore((s) => s.setActive)
  const clearActive = useConnStore((s) => s.clearActive)
  const activeConnectionId = useConnStore((s) => s.activeConnectionId)
  const setMode = useThemeStore((s) => s.setMode)

  // Connect (or switch): closes the previously-open connection so switching from
  // the revealed list doesn't leak the old session.
  function connectTo(connectionId: string, profileId: string, database: string | null): void {
    const prev = activeConnectionId
    setActive(connectionId, profileId, database)
    setView({ kind: 'connected' })
    setShowConnList(false)
    if (prev && prev !== connectionId) void window.fordb.connection.close(prev)
  }
  const mainView = useQueryStore((s) => s.mainView)
  const setMainView = useQueryStore((s) => s.setMainView)
  const { dialect, sqlLang } = useDialect()
  // Hide the Dashboard tab for engines without server stats (e.g. SQLite).
  const statsSupported = useServerStatsSupported(activeConnectionId).data ?? false
  // Mongo has its own server-status dashboard (opcounters/connections/mem/repl)
  // — mutually exclusive with the PG `statsSupported` gate above.
  const mongoStatsSupported = useMongoStatsSupported(activeConnectionId).data ?? false
  const dashboardSupported = statsSupported || mongoStatsSupported
  // Document-mode engines (MongoDB) have no SQL surface — hide the SQL-authoring
  // palette commands (Import SQL file, Explain, default SQL new-tab) so they
  // aren't dead affordances (M7 Phase-1 M3).
  const docSupported = useDocumentQuerySupported(activeConnectionId).data ?? false

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
    // The default new-tab is a SQL editor — a dead affordance on a document-mode
    // (Mongo) connection, which has no SQL surface. New doc tabs open only via
    // clicking a collection in the schema tree (SchemaTree's openCollection).
    ...(docSupported
      ? []
      : [
          {
            id: 'new-query-tab',
            label: 'New query tab',
            run: () => useQueryStore.getState().newTab()
          }
        ]),
    { id: 'show-dashboard', label: 'Show dashboard', run: () => setMainView('dashboard') },
    { id: 'show-query', label: 'Show query', run: () => setMainView('query') },
    {
      id: 'refresh-schema',
      label: 'Refresh schema',
      run: () => {
        if (activeConnectionId) void invalidateIntrospection(queryClient, activeConnectionId)
      }
    },
    {
      id: 'format-sql',
      label: 'Format SQL',
      run: () => useQueryStore.getState().formatActive(sqlLang)
    },
    // Explain (and Explain analyze) are SQL-only — hide entirely on a
    // document-mode (Mongo) connection.
    ...(docSupported
      ? []
      : [
          {
            id: 'explain',
            label: 'Explain',
            run: () => void useQueryStore.getState().openExplain(dialect, false)
          },
          // EXPLAIN ANALYZE is Postgres-only (SQLite has no ANALYZE plan); hide the
          // command for SQLite so it isn't a dead palette entry.
          ...(dialect === 'pg'
            ? [
                {
                  id: 'explain-analyze',
                  label: 'Explain analyze',
                  run: () => void useQueryStore.getState().openExplain(dialect, true)
                }
              ]
            : [])
        ]),
    {
      id: 'save-query',
      label: 'Save query',
      run: () => useQueryStore.getState().setPicker('save')
    },
    {
      id: 'open-saved-query',
      label: 'Open saved query',
      run: () => useQueryStore.getState().setPicker('saved')
    },
    {
      id: 'query-history',
      label: 'Query history',
      run: () => useQueryStore.getState().setPicker('history')
    },
    // executeScript (SQL statements) has no equivalent on a document-mode
    // (Mongo) connection — hide rather than surface a dead banner error.
    ...(docSupported
      ? []
      : [
          {
            id: 'import-sql',
            label: 'Import SQL file',
            run: () => void useQueryStore.getState().importSqlFile()
          }
        ]),
    { id: 'theme-light', label: 'Theme: Light', run: () => void setMode('light') },
    { id: 'theme-dark', label: 'Theme: Dark', run: () => void setMode('dark') },
    { id: 'theme-system', label: 'Theme: System', run: () => void setMode('system') }
  ]

  return (
    <div className="flex h-screen flex-col overflow-hidden text-foreground bg-background">
      <TitleBar />
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup direction="horizontal">
          {/* Left sidebar. Not connected: the connection list (landing). Connected:
            a compact active-connection bar + the schema tree; a toggle reveals the
            connection list to switch, without closing the current session. */}
          <ResizablePanel defaultSize={18} minSize={12} maxSize={40} className="flex flex-col">
            {view.kind === 'connected' ? (
              <>
                <ActiveConnectionBar
                  listOpen={showConnList}
                  onToggleList={() => setShowConnList((v) => !v)}
                  onDisconnect={() => {
                    if (activeConnectionId) void window.fordb.connection.close(activeConnectionId)
                    clearActive()
                    setShowConnList(false)
                    setView({ kind: 'welcome' })
                  }}
                />
                {showConnList ? (
                  <ConnectionList
                    onNew={() => setView({ kind: 'form' })}
                    onEdit={(profile) => setView({ kind: 'form', profile })}
                    onConnect={connectTo}
                  />
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <DatabaseSwitcher />
                    <div className="flex justify-end border-b border-border px-2 py-1">
                      <RefreshSchemaButton />
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      <SchemaTree />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <ConnectionList
                onNew={() => setView({ kind: 'form' })}
                onEdit={(profile) => setView({ kind: 'form', profile })}
                onConnect={connectTo}
              />
            )}
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
                    {dashboardSupported && (
                      <button
                        aria-pressed={mainView === 'dashboard'}
                        className={`rounded px-2 py-0.5 text-sm ${mainView === 'dashboard' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                        onClick={() => setMainView('dashboard')}
                      >
                        Dashboard
                      </button>
                    )}
                    <button
                      aria-pressed={mainView === 'query'}
                      className={`rounded px-2 py-0.5 text-sm ${mainView === 'query' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                      onClick={() => setMainView('query')}
                    >
                      Query
                    </button>
                  </div>
                  <div className="min-h-0 flex-1">
                    {mainView === 'dashboard' && mongoStatsSupported ? (
                      <MongoDashboard />
                    ) : mainView === 'dashboard' && statsSupported ? (
                      <ServerDashboard />
                    ) : (
                      <QueryWorkbench />
                    )}
                  </div>
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <StatusBar />
      <CommandPalette commands={commands} />
      <QueryLibrary />
      <CsvImportDialog />
      <ImportErrorBanner />
    </div>
  )
}

function ImportErrorBanner(): React.JSX.Element | null {
  const err = useQueryStore((s) => s.ioError)
  const clear = useQueryStore((s) => s.clearIoError)
  if (!err) return null
  return (
    <div className="fixed bottom-8 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-start gap-2 rounded border border-border bg-destructive/10 p-2 text-sm text-destructive shadow">
      <span className="min-w-0 break-words">Export/import failed: {err}</span>
      <button className="shrink-0 hover:underline" onClick={clear}>
        dismiss
      </button>
    </div>
  )
}

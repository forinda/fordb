import { useEffect, useState } from 'react'
import { AiPanel } from './components/AiPanel'
import { CommandPalette } from './components/CommandPalette'
import { ConnectionManager } from './components/ConnectionManager'
import { ProfileForm } from './components/ProfileForm'
import { SchemaTree } from './components/SchemaTree'
import { DatabaseHeader } from './components/DatabaseHeader'
import { TitleBar } from './components/TitleBar'
import { UpdateBanner } from './components/UpdateBanner'
import { useUpdaterSubscription } from './store-updater'
import { StatusBar } from './components/StatusBar'
import { ConnectingOverlay } from './components/ConnectingOverlay'
import { RunToast } from './components/RunToast'
import { QueryWorkbench } from './components/QueryWorkbench'
import { QueryLibrary } from './components/QueryLibrary'
import { CsvImportDialog } from './components/CsvImportDialog'
import { ActiveConnectionBar } from './components/ActiveConnectionBar'
import { SidebarSettingsRow } from './components/SidebarSettingsRow'
import { MonitoringView } from './components/MonitoringView'
import { MongoDashboard } from './components/MongoDashboard'
import { RolesView } from './components/RolesView'
import { ServerSettingsView } from './components/ServerSettingsView'
import { ExportView } from './components/ExportView'
import { ImportView } from './components/ImportView'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './components/ui/resizable'
import { queryClient } from './query/client'
import { invalidateIntrospection } from './query/introspection'
import { useServerStatsSupported } from './query/stats'
import { useMongoStatsSupported } from './query/mongo-stats'
import { useServerAdminSupported } from './query/admin'
import { useConnStore } from './store'
import { useUiStore } from './store-ui'
import { useInvalidateProfiles } from './query/profiles'
import { connectionLabel } from '@shared/connection-label'
import { useThemeStore } from './store-theme'
import { useQueryStore } from './store-query'
import { useDialect } from './query/use-dialect'
import { useDocumentQuerySupported } from './query/documents'
import type { ConnectionProfile } from '@shared/adapter/types'
// The global `Window.fordb` type is declared once in ./rpc.ts (imported for
// its ambient `declare global` augmentation).
import './rpc'

export function App(): React.JSX.Element {
  // Profile form overlay on the Connections screen — independent of the
  // connection lifecycle so editing a profile never tears down the session.
  const [form, setForm] = useState<{ profile?: ConnectionProfile } | null>(null)
  // Selected (not necessarily connected) profile — drives the right details
  // panel on the Connections screen (Dialect: connect happens there).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Editor-screen sidebar visibility (toggle from the title bar / palette).
  const [showSidebar, setShowSidebar] = useState(true)
  // AI assistant panel visibility (toggle from the status bar) — unmounted
  // (not just hidden) when closed so it holds no state/subscriptions idle.
  const [aiOpen, setAiOpen] = useState(false)
  const setActive = useConnStore((s) => s.setActive)
  const clearActive = useConnStore((s) => s.clearActive)
  const activeConnectionId = useConnStore((s) => s.activeConnectionId)
  // Single source of truth for "connected" (I2): the store. view-based gating
  // diverged from connectionLost(), which can only clear the store.
  const connected = activeConnectionId !== null
  const setMode = useThemeStore((s) => s.setMode)
  useUpdaterSubscription()

  // Connect (or switch): closes the previously-open connection so switching from
  // the revealed list doesn't leak the old session.
  function connectTo(connectionId: string, profileId: string, database: string | null): void {
    const prev = activeConnectionId
    setActive(connectionId, profileId, database)
    useQueryStore.getState().setMainView('query')
    if (prev && prev !== connectionId) void window.fordb.connection.close(prev)
  }
  const mainView = useQueryStore((s) => s.mainView)
  const setMainView = useQueryStore((s) => s.setMainView)
  const requestUsers = useUiStore((s) => s.requestUsers)
  const { dialect, sqlLang } = useDialect()
  // Hide the Monitoring destination for engines without server stats (e.g. SQLite).
  const statsSupported = useServerStatsSupported(activeConnectionId).data ?? false
  // Mongo has its own server-status dashboard (opcounters/connections/mem/repl)
  // — mutually exclusive with the PG `statsSupported` gate above.
  const mongoStatsSupported = useMongoStatsSupported(activeConnectionId).data ?? false
  const dashboardSupported = statsSupported || mongoStatsSupported
  // Roles + server settings are Postgres-only full-pane views (Adminer-flat).
  const adminSupported = useServerAdminSupported(activeConnectionId).data ?? false
  // Document-mode engines (MongoDB) have no SQL surface — hide the SQL-authoring
  // palette commands (Import SQL file, Explain, default SQL new-tab) so they
  // aren't dead affordances (M7 Phase-1 M3).
  const docSupported = useDocumentQuerySupported(activeConnectionId).data ?? false

  useEffect(() => {
    void useThemeStore.getState().init()
    window.fordb.onDbHostRestarted(() => useQueryStore.getState().connectionLost())
  }, [])
  // Losing the connection (restart, active-profile delete) strands every other
  // destination — fall back to Connections, the only one that still works.
  useEffect(() => {
    if (!connected) setMainView('connections')
  }, [connected, setMainView])

  const commands = [
    {
      id: 'new',
      group: 'Connection',
      label: 'New connection',
      run: () => {
        setMainView('connections')
        setForm({})
      }
    },
    {
      id: 'disconnect',
      group: 'Connection',
      label: 'Disconnect',
      run: () => {
        if (activeConnectionId) void window.fordb.connection.close(activeConnectionId)
        clearActive()
        setMainView('connections')
      }
    },
    {
      id: 'show-connections',
      group: 'View',
      label: 'Show connections',
      run: () => setMainView('connections')
    },
    {
      id: 'run-query',
      group: 'Query',
      label: 'Run query',
      shortcut: window.fordb.platform === 'darwin' ? '⌘⏎' : 'Ctrl ⏎',
      run: () => {
        const s = useQueryStore.getState()
        if (s.activeTabId) void s.run(s.activeTabId)
      }
    },
    {
      id: 'cancel-query',
      group: 'Query',
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
            group: 'Query',
            label: 'New query tab',
            run: () => useQueryStore.getState().newTab()
          }
        ]),
    {
      id: 'show-monitoring',
      group: 'View',
      label: 'Show monitoring',
      run: () => setMainView('monitoring')
    },
    { id: 'show-query', group: 'View', label: 'Show query', run: () => setMainView('query') },
    {
      id: 'refresh-schema',
      group: 'View',
      label: 'Refresh schema',
      run: () => {
        if (activeConnectionId) void invalidateIntrospection(queryClient, activeConnectionId)
      }
    },
    {
      id: 'format-sql',
      group: 'Query',
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
            group: 'Query',
            label: 'Explain',
            run: () => void useQueryStore.getState().openExplain(dialect, false)
          },
          // EXPLAIN ANALYZE is Postgres-only (SQLite has no ANALYZE plan); hide the
          // command for SQLite so it isn't a dead palette entry.
          ...(dialect === 'pg'
            ? [
                {
                  id: 'explain-analyze',
                  group: 'Query',
                  label: 'Explain analyze',
                  run: () => void useQueryStore.getState().openExplain(dialect, true)
                }
              ]
            : [])
        ]),
    {
      id: 'save-query',
      group: 'Library',
      label: 'Save query',
      run: () => useQueryStore.getState().setPicker('save')
    },
    {
      id: 'open-saved-query',
      group: 'Library',
      label: 'Open saved query',
      run: () => useQueryStore.getState().setPicker('saved')
    },
    {
      id: 'query-history',
      group: 'Library',
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
            group: 'Data',
            label: 'Import SQL file',
            run: () => void useQueryStore.getState().importSqlFile()
          }
        ]),
    {
      id: 'toggle-sidebar',
      group: 'View',
      label: 'Toggle sidebar',
      run: () => setShowSidebar((v) => !v)
    },
    {
      id: 'theme-light',
      group: 'Appearance',
      label: 'Theme: Light',
      run: () => void setMode('light')
    },
    {
      id: 'theme-dark',
      group: 'Appearance',
      label: 'Theme: Dark',
      run: () => void setMode('dark')
    },
    {
      id: 'theme-system',
      group: 'Appearance',
      label: 'Theme: System',
      run: () => void setMode('system')
    },
    {
      id: 'check-updates',
      group: 'Application',
      label: 'Check for updates',
      run: () => void window.fordb.updater.check()
    }
  ]

  return (
    <div className="flex h-screen flex-col overflow-hidden text-foreground bg-background">
      <UpdateBanner />
      <TitleBar
        onToggleSidebar={() => setShowSidebar((v) => !v)}
        sidebarVisible={showSidebar}
        sidebarAvailable={connected}
      />
      <div className="min-h-0 flex-1">
        {/* Disconnected: Connections is the whole window — there is no schema
            to put in a sidebar and no other destination that works. Once
            connected it becomes a destination like any other, so managing
            connections no longer costs you the schema tree. */}
        {!connected ? (
          <ConnectionsScreen
            form={form}
            setForm={setForm}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            onConnect={connectTo}
          />
        ) : (
          <div className="flex h-full min-h-0">
            <div className="min-w-0 flex-1">
              <ResizablePanelGroup direction="horizontal">
                {/* Editor sidebar: active-connection bar + schema tree. Switching
                connections happens on the title bar's Connections screen. */}
                {showSidebar && (
                  <ResizablePanel
                    defaultSize={18}
                    minSize={12}
                    maxSize={40}
                    className="flex flex-col bg-surface-1"
                  >
                    {connected ? (
                      <>
                        <ActiveConnectionBar
                          onConnect={connectTo}
                          onAddConnection={() => {
                            setMainView('connections')
                            setForm({})
                          }}
                          onDisconnect={() => {
                            if (activeConnectionId)
                              void window.fordb.connection.close(activeConnectionId)
                            clearActive()
                            setMainView('connections')
                          }}
                        />
                        {/* The "Search…" button that used to sit here only
                            dispatched the ⌘K palette event — it looked like an
                            input you could type into but wasn't one, and it sat
                            directly above the tree's real filter box. The
                            shortcut is advertised in the status bar instead. */}
                        <div className="flex min-h-0 flex-1 flex-col">
                          <DatabaseHeader />
                          <div className="min-h-0 flex-1 overflow-auto">
                            <SchemaTree />
                          </div>
                          <SidebarSettingsRow />
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 p-3 text-sm text-muted-foreground">
                        Select a connection to get started.
                      </div>
                    )}
                  </ResizablePanel>
                )}
                {showSidebar && <ResizableHandle withHandle />}
                <ResizablePanel className="min-w-0">
                  <div className="h-full overflow-auto">
                    {connected && (
                      <div className="flex h-full flex-col">
                        <div className="flex gap-1 border-b border-border p-1">
                          {/* Connections is a destination like the rest now —
                              it used to be a separate `screen` toggled from the
                              title bar, a second navigation axis on top of this
                              one. */}
                          <button
                            aria-pressed={mainView === 'connections'}
                            className={`rounded px-2 py-0.5 text-sm ${mainView === 'connections' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                            onClick={() => setMainView('connections')}
                          >
                            Connections
                          </button>
                          <button
                            aria-pressed={mainView === 'query'}
                            className={`rounded px-2 py-0.5 text-sm ${mainView === 'query' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                            onClick={() => setMainView('query')}
                          >
                            Query
                          </button>
                          {dashboardSupported && (
                            <button
                              aria-pressed={mainView === 'monitoring'}
                              className={`rounded px-2 py-0.5 text-sm ${mainView === 'monitoring' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                              onClick={() => setMainView('monitoring')}
                            >
                              Monitoring
                            </button>
                          )}
                          {adminSupported && (
                            <button
                              aria-pressed={mainView === 'roles'}
                              className={`rounded px-2 py-0.5 text-sm ${mainView === 'roles' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                              onClick={() => setMainView('roles')}
                            >
                              Roles
                            </button>
                          )}
                          {adminSupported && (
                            <button
                              aria-pressed={mainView === 'serverSettings'}
                              className={`rounded px-2 py-0.5 text-sm ${mainView === 'serverSettings' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                              onClick={() => setMainView('serverSettings')}
                            >
                              Server settings
                            </button>
                          )}
                          {/* Mongo has no roles view; its users are a modal (owned by
                              SchemaTree), opened via the one-shot ui-store flag. */}
                          {docSupported && (
                            <button
                              className="rounded px-2 py-0.5 text-sm text-muted-foreground"
                              onClick={() => requestUsers()}
                            >
                              Users
                            </button>
                          )}
                          {/* Export/Import are relational (SQL) destinations; Mongo has
                              its own per-tab document export. */}
                          {!docSupported && (
                            <button
                              aria-pressed={mainView === 'export'}
                              className={`rounded px-2 py-0.5 text-sm ${mainView === 'export' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                              onClick={() => setMainView('export')}
                            >
                              Export
                            </button>
                          )}
                          {!docSupported && (
                            <button
                              aria-pressed={mainView === 'import'}
                              className={`rounded px-2 py-0.5 text-sm ${mainView === 'import' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                              onClick={() => setMainView('import')}
                            >
                              Import
                            </button>
                          )}
                        </div>
                        <div className="min-h-0 flex-1">
                          {mainView === 'connections' ? (
                            <ConnectionsScreen
                              form={form}
                              setForm={setForm}
                              selectedId={selectedId}
                              setSelectedId={setSelectedId}
                              onConnect={connectTo}
                            />
                          ) : mainView === 'roles' ? (
                            <RolesView />
                          ) : mainView === 'export' ? (
                            <ExportView />
                          ) : mainView === 'import' ? (
                            <ImportView />
                          ) : mainView === 'serverSettings' ? (
                            <ServerSettingsView />
                          ) : mainView === 'monitoring' && mongoStatsSupported ? (
                            <MongoDashboard />
                          ) : mainView === 'monitoring' && statsSupported ? (
                            <MonitoringView />
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
            {aiOpen && (
              <aside className="w-80 flex-none border-l border-border bg-surface-1">
                <AiPanel />
              </aside>
            )}
          </div>
        )}
      </div>
      <StatusBar aiOpen={aiOpen} onToggleAi={() => setAiOpen((v) => !v)} />
      <CommandPalette commands={commands} onConnect={connectTo} />
      <QueryLibrary />
      <CsvImportDialog />
      <ImportErrorBanner />
      <ConnectingOverlay />
      <RunToast />
    </div>
  )
}

/** Connections screen: one list. The 340px right panel now appears only while
 *  adding/editing a profile — selecting a connection expands it in place, so
 *  the details column is no longer a permanent third of the screen. */
function ConnectionsScreen(props: {
  form: { profile?: ConnectionProfile } | null
  setForm: (f: { profile?: ConnectionProfile } | null) => void
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  onConnect: (connectionId: string, profileId: string, database: string | null) => void
}): React.JSX.Element {
  const invalidateProfiles = useInvalidateProfiles()
  const activeProfileId = useConnStore((s) => s.activeProfileId)
  const activeConnectionId = useConnStore((s) => s.activeConnectionId)
  const clearActive = useConnStore((s) => s.clearActive)

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1">
        <ConnectionManager
          selectedId={props.selectedId}
          onSelect={(p) => {
            // Clicking the selected row again collapses it.
            props.setSelectedId(p.id === props.selectedId ? null : p.id)
            props.setForm(null)
          }}
          onNew={() => props.setForm({})}
          onEdit={(p) => props.setForm({ profile: p })}
          onConnect={props.onConnect}
          onDelete={(p) => {
            const isActiveProfile = p.id === activeProfileId
            const msg = isActiveProfile
              ? `Delete "${connectionLabel(p)}"? This disconnects the current session and removes its stored secrets.`
              : `Delete "${connectionLabel(p)}"? This removes its stored secrets.`
            if (!window.confirm(msg)) return
            // Deleting the active profile must not orphan the live session:
            // close + clear before the profile (and keychain entry) go away.
            if (isActiveProfile) {
              if (activeConnectionId) void window.fordb.connection.close(activeConnectionId)
              clearActive()
            }
            props.setSelectedId(null)
            void window.fordb.profiles.delete(p.id).then(() => invalidateProfiles())
          }}
        />
      </div>
      {props.form && (
        <aside className="w-[340px] flex-none overflow-auto border-l border-border bg-card">
          <ProfileForm
            profile={props.form.profile}
            onSaved={() => props.setForm(null)}
            onCancel={() => props.setForm(null)}
          />
        </aside>
      )}
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

import { useEffect, useState } from 'react'
import { AiPanel } from './components/AiPanel'
import { CommandPalette } from './components/CommandPalette'
import { ConnectionManager, ConnectionDetails } from './components/ConnectionManager'
import { ProfileForm } from './components/ProfileForm'
import { SchemaTree } from './components/SchemaTree'
import { RefreshSchemaButton } from './components/RefreshSchemaButton'
import { DatabaseSwitcher } from './components/DatabaseSwitcher'
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
import { ServerDashboard } from './components/ServerDashboard'
import { MongoDashboard } from './components/MongoDashboard'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './components/ui/resizable'
import { queryClient } from './query/client'
import { invalidateIntrospection } from './query/introspection'
import { useServerStatsSupported } from './query/stats'
import { useMongoStatsSupported } from './query/mongo-stats'
import { useConnStore } from './store'
import { useProfiles, useInvalidateProfiles } from './query/profiles'
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
  // Top-level screen per the Dialect design: Connections (manager) vs Editor,
  // toggled from the title bar; Editor needs a live connection.
  const [screen, setScreen] = useState<'connections' | 'editor'>('connections')
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
    setScreen('editor')
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
  // Losing the connection (restart, active-profile delete) strands the editor
  // screen — fall back to Connections.
  useEffect(() => {
    if (!connected) setScreen('connections')
  }, [connected])

  const commands = [
    {
      id: 'new',
      label: 'New connection',
      run: () => {
        setScreen('connections')
        setForm({})
      }
    },
    {
      id: 'disconnect',
      label: 'Disconnect',
      run: () => {
        if (activeConnectionId) void window.fordb.connection.close(activeConnectionId)
        clearActive()
        setScreen('connections')
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
    { id: 'toggle-sidebar', label: 'Toggle sidebar', run: () => setShowSidebar((v) => !v) },
    { id: 'theme-light', label: 'Theme: Light', run: () => void setMode('light') },
    { id: 'theme-dark', label: 'Theme: Dark', run: () => void setMode('dark') },
    { id: 'theme-system', label: 'Theme: System', run: () => void setMode('system') },
    {
      id: 'check-updates',
      label: 'Check for updates',
      run: () => void window.fordb.updater.check()
    }
  ]

  return (
    <div className="flex h-screen flex-col overflow-hidden text-foreground bg-background">
      <UpdateBanner />
      <TitleBar
        screen={screen}
        onScreenChange={(next) => {
          setScreen(next)
          if (next === 'editor') setForm(null) // don't resurface a stale form later (M4)
        }}
        editorEnabled={connected}
        onToggleSidebar={() => setShowSidebar((v) => !v)}
        sidebarVisible={showSidebar}
      />
      <div className="min-h-0 flex-1">
        {screen === 'connections' ? (
          /* Connections screen: the manager IS the page; the profile form
             opens as a 340px right panel beside it (Dialect design) with a
             direct Connect action. */
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
                          onDisconnect={() => {
                            if (activeConnectionId)
                              void window.fordb.connection.close(activeConnectionId)
                            clearActive()
                            setScreen('connections')
                          }}
                        />
                        <div className="flex min-h-0 flex-1 flex-col">
                          <button
                            className="mx-2 mt-2 flex items-center justify-between rounded border border-border bg-surface-2 px-2 py-1 text-xs text-muted-foreground hover:border-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => window.dispatchEvent(new Event('fordb:palette-toggle'))}
                          >
                            <span>Search…</span>
                            <span className="rounded border border-border bg-background px-1 text-[10px]">
                              {window.fordb.platform === 'darwin' ? '⌘K' : 'Ctrl K'}
                            </span>
                          </button>
                          <DatabaseSwitcher />
                          <div className="flex justify-end border-b border-border px-2 py-1">
                            <RefreshSchemaButton />
                          </div>
                          <div className="min-h-0 flex-1 overflow-auto">
                            <SchemaTree />
                          </div>
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

/** Connections screen: manager + a 340px right panel hosting the profile
 *  form (new/edit) or the selected profile's details (Connect lives there). */
function ConnectionsScreen(props: {
  form: { profile?: ConnectionProfile } | null
  setForm: (f: { profile?: ConnectionProfile } | null) => void
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  onConnect: (connectionId: string, profileId: string, database: string | null) => void
}): React.JSX.Element {
  const { data: profiles = [] } = useProfiles()
  const invalidateProfiles = useInvalidateProfiles()
  const activeProfileId = useConnStore((s) => s.activeProfileId)
  const activeConnectionId = useConnStore((s) => s.activeConnectionId)
  const clearActive = useConnStore((s) => s.clearActive)
  const selected = profiles.find((p) => p.id === props.selectedId) ?? null

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1">
        <ConnectionManager
          selectedId={props.selectedId}
          onSelect={(p) => {
            props.setSelectedId(p.id)
            props.setForm(null)
          }}
          onNew={() => props.setForm({})}
        />
      </div>
      {(props.form || selected) && (
        <aside className="w-[340px] flex-none overflow-auto border-l border-border bg-card">
          {props.form ? (
            <ProfileForm
              profile={props.form.profile}
              onSaved={() => props.setForm(null)}
              onCancel={() => props.setForm(null)}
            />
          ) : selected ? (
            <ConnectionDetails
              profile={selected}
              onConnect={props.onConnect}
              onEdit={() => props.setForm({ profile: selected })}
              onDelete={() => {
                const isActiveProfile = selected.id === activeProfileId
                const msg = isActiveProfile
                  ? `Delete "${connectionLabel(selected)}"? This disconnects the current session and removes its stored secrets.`
                  : `Delete "${connectionLabel(selected)}"? This removes its stored secrets.`
                if (!window.confirm(msg)) return
                // Deleting the active profile must not orphan the live session:
                // close + clear before the profile (and keychain entry) go away.
                if (isActiveProfile) {
                  if (activeConnectionId) void window.fordb.connection.close(activeConnectionId)
                  clearActive()
                }
                props.setSelectedId(null)
                void window.fordb.profiles.delete(selected.id).then(() => invalidateProfiles())
              }}
            />
          ) : null}
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

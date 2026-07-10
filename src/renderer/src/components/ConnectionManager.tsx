import { useMemo, useState } from 'react'
import IconDatabase from '~icons/lucide/database'
import IconStar from '~icons/lucide/star'
import IconPlugConnected from '~icons/lucide/plug-zap'
import type { ConnectionProfile } from '@shared/adapter/types'
import { connectionLabel } from '@shared/connection-label'
import { filterProfiles, type ProfileFilter } from '@shared/profile-filter'
import { useProfiles, useInvalidateProfiles } from '../query/profiles'
import { useConnStore } from '../store'
import { Button } from './ui/button'

const ENVIRONMENTS = ['production', 'staging', 'local'] as const
type Environment = (typeof ENVIRONMENTS)[number]

function envBadge(env: Environment): string {
  // Production reads as a warning per the Dialect mockup; others neutral.
  return env === 'production'
    ? 'bg-warning/15 text-warning border border-warning/40'
    : 'bg-surface-2 text-muted-foreground border border-border'
}

function RailRow(props: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        props.active ? 'bg-primary/10 text-primary' : 'text-foreground-soft hover:bg-surface-2'
      }`}
      onClick={props.onClick}
    >
      <span className="truncate">{props.label}</span>
      {props.count != null && <span className="text-xs text-faint">{props.count}</span>}
    </button>
  )
}

/** Dialect connections manager. `full` = landing page with the filter rail;
 *  `slim` (T3) = compact single-column switcher for the connected sidebar. */
export function ConnectionManager(props: {
  variant: 'full'
  onConnect: (connectionId: string, profileId: string, database: string | null) => void
  onEdit: (profile: ConnectionProfile) => void
  onNew: () => void
}): React.JSX.Element {
  const { data: profiles = [] } = useProfiles()
  const invalidateProfiles = useInvalidateProfiles()
  const activeProfileId = useConnStore((s) => s.activeProfileId)
  const [engine, setEngine] = useState<ConnectionProfile['engine'] | null>(null)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [environment, setEnvironment] = useState<Environment | null>(null)
  const [search, setSearch] = useState('')
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)

  const filter: ProfileFilter = {
    engine: engine ?? undefined,
    environment: environment ?? undefined,
    favoritesOnly: favoritesOnly || undefined,
    search: search || undefined
  }
  const shown = useMemo(() => filterProfiles(profiles, filter), [profiles, filter])
  const engines = useMemo(() => {
    const counts = new Map<ConnectionProfile['engine'], number>()
    for (const p of profiles) counts.set(p.engine, (counts.get(p.engine) ?? 0) + 1)
    return [...counts.entries()]
  }, [profiles])

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
    <div className="flex h-full min-h-0">
      {/* Filter rail */}
      <div className="flex w-44 flex-none flex-col gap-4 overflow-auto border-r border-border bg-surface-1 p-3">
        <div>
          <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Engines
          </div>
          <RailRow
            label="All engines"
            count={profiles.length}
            active={engine === null && !favoritesOnly}
            onClick={() => {
              setEngine(null)
              setFavoritesOnly(false)
            }}
          />
          {engines.map(([eng, count]) => (
            <RailRow
              key={eng}
              label={eng}
              count={count}
              active={engine === eng}
              onClick={() => {
                setEngine(engine === eng ? null : eng)
                setFavoritesOnly(false)
              }}
            />
          ))}
          <RailRow
            label="Favorites"
            active={favoritesOnly}
            onClick={() => setFavoritesOnly((v) => !v)}
          />
        </div>
        <div>
          <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Environments
          </div>
          {ENVIRONMENTS.map((env) => (
            <RailRow
              key={env}
              label={env[0]!.toUpperCase() + env.slice(1)}
              active={environment === env}
              onClick={() => setEnvironment(environment === env ? null : env)}
            />
          ))}
        </div>
      </div>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto p-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-foreground">Connections</h1>
          <input
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
            placeholder="Search connections…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {/* The zero-profiles empty state renders its own CTA with this exact
              text; render only one at a time (e2e getByText is strict). */}
          {profiles.length > 0 && <Button onClick={props.onNew}>+ New connection</Button>}
        </div>
        {connectError && <div className="text-sm text-destructive">{connectError}</div>}
        {profiles.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <IconDatabase className="h-8 w-8 text-faint" />
            <span>No connections yet.</span>
            <Button onClick={props.onNew}>+ New connection</Button>
          </div>
        )}
        {profiles.length > 0 && shown.length === 0 && (
          <div className="p-6 text-center text-muted-foreground">No connections match.</div>
        )}
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {shown.map((p) => {
            const isActive = p.id === activeProfileId
            return (
              <div
                key={p.id}
                className="group flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-raised)] hover:border-border-strong"
              >
                <IconDatabase className="h-5 w-5 flex-none text-primary" />
                <div className="min-w-0 flex-1">
                  <button
                    className="flex items-center gap-1.5 text-left text-sm font-medium text-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
                    disabled={connectingId !== null}
                    onClick={() => void connect(p.id)}
                  >
                    {isActive && (
                      <IconPlugConnected
                        className="h-3.5 w-3.5 flex-none text-primary"
                        aria-label="connected"
                      />
                    )}
                    <span className="truncate">{connectionLabel(p)}</span>
                    {connectingId === p.id && (
                      <span className="text-xs text-muted-foreground">connecting…</span>
                    )}
                  </button>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.engine}
                    {p.environment && (
                      <span
                        className={`ml-2 rounded px-1 py-px text-[10px] uppercase ${envBadge(p.environment)}`}
                      >
                        {p.environment}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  aria-label={p.favorite ? 'unfavorite' : 'favorite'}
                  aria-pressed={Boolean(p.favorite)}
                  title={p.favorite ? 'Unfavorite' : 'Favorite'}
                  className="flex-none rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    // Metadata-only save: empty secretFields → keychain untouched.
                    void window.fordb.profiles
                      .save({ ...p, favorite: !p.favorite || undefined }, {})
                      .then(() => invalidateProfiles())
                  }}
                >
                  <IconStar
                    className={`h-4 w-4 ${
                      p.favorite
                        ? 'fill-warning text-warning'
                        : 'text-faint opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-warning'
                    }`}
                  />
                </button>
                <div className="flex flex-none gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    className="rounded px-1 text-xs text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => props.onEdit(p)}
                  >
                    edit
                  </button>
                  <button
                    className="rounded px-1 text-xs text-muted-foreground hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      void window.fordb.profiles.delete(p.id).then(() => invalidateProfiles())
                    }}
                  >
                    del
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

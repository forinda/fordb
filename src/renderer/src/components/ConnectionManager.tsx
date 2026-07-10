import { useMemo, useState } from 'react'
import IconDatabase from '~icons/lucide/database'
import IconStar from '~icons/lucide/star'
import IconPlugConnected from '~icons/lucide/plug-zap'
import type { ConnectionProfile } from '@shared/adapter/types'
import { connectionLabel } from '@shared/connection-label'
import { filterProfiles, type ProfileFilter } from '@shared/profile-filter'
import { useProfiles, useInvalidateProfiles } from '../query/profiles'
import { useConnStore } from '../store'
import { useUiStore } from '../store-ui'
import { Button } from './ui/button'

const ENVIRONMENTS = ['production', 'staging', 'local'] as const
type Environment = (typeof ENVIRONMENTS)[number]

export const ENV_DOT: Record<Environment, string> = {
  production: 'bg-warning',
  staging: 'bg-info',
  local: 'bg-success'
}

/** Engine glyph badge (Dialect): colored tile + 2-letter glyph. */
export function EngineGlyph(props: {
  engine: ConnectionProfile['engine']
  size?: 'sm' | 'lg'
}): React.JSX.Element {
  const map = {
    postgres: { glyph: 'Pg', cls: 'bg-primary' },
    sqlite: { glyph: 'Sq', cls: 'bg-info' },
    mongodb: { glyph: 'Mo', cls: 'bg-success' }
  } as const
  const m = map[props.engine]
  const size =
    props.size === 'lg' ? 'h-10 w-10 rounded-[10px] text-sm' : 'h-7 w-7 rounded-lg text-[11px]'
  return (
    <span
      className={`inline-flex flex-none items-center justify-center font-extrabold text-white ${size} ${m.cls}`}
    >
      {m.glyph}
    </span>
  )
}

/** Non-secret address line for a profile (mono, Dialect card second line). */
export function profileAddress(p: ConnectionProfile): string {
  if (p.engine === 'postgres') return `${p.host}:${p.port}`
  if (p.engine === 'sqlite')
    return p.kind === 'local' ? p.file : p.kind === 'remote' ? p.url : p.file
  return p.host ? `${p.host}:${p.port ?? 27017}` : (p.database ?? 'mongodb')
}

function RailRow(props: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
  leading?: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        props.active
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-foreground-soft hover:bg-surface-2'
      }`}
      onClick={props.onClick}
    >
      {props.leading}
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.count != null && <span className="flex-none text-xs text-faint">{props.count}</span>}
    </button>
  )
}

/** Dialect connections manager: rail (New Connection, engines, environments),
 *  environment-grouped card sections, search. Clicking a card SELECTS it —
 *  App shows the details panel (Connect lives there). */
export function ConnectionManager(props: {
  selectedId: string | null
  onSelect: (profile: ConnectionProfile) => void
  onNew: () => void
}): React.JSX.Element {
  const { data: profiles = [] } = useProfiles()
  const invalidateProfiles = useInvalidateProfiles()
  const activeProfileId = useConnStore((s) => s.activeProfileId)
  const [engine, setEngine] = useState<ConnectionProfile['engine'] | null>(null)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [environment, setEnvironment] = useState<Environment | null>(null)
  const [search, setSearch] = useState('')

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
  const favoriteCount = useMemo(() => profiles.filter((p) => p.favorite).length, [profiles])

  // Environment-grouped sections (untagged last), per the Dialect mockup.
  const sections = useMemo(() => {
    const bucket = (env: Environment | null): ConnectionProfile[] =>
      shown.filter((p) => (p.environment ?? null) === env)
    const out: { env: Environment | null; items: ConnectionProfile[] }[] = []
    for (const env of ENVIRONMENTS) {
      const items = bucket(env)
      if (items.length) out.push({ env, items })
    }
    const untagged = bucket(null)
    if (untagged.length) out.push({ env: null, items: untagged })
    return out
  }, [shown])

  function Card(p: ConnectionProfile): React.JSX.Element {
    const isActive = p.id === activeProfileId
    const isSelected = p.id === props.selectedId
    return (
      <div
        key={p.id}
        role="button"
        tabIndex={0}
        onClick={() => props.onSelect(p)}
        onKeyDown={(e) => e.key === 'Enter' && props.onSelect(p)}
        className={`group relative cursor-pointer rounded-xl border bg-card p-3 shadow-[var(--shadow-raised)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          isSelected
            ? 'border-primary ring-2 ring-primary/25'
            : 'border-border hover:border-border-strong'
        }`}
      >
        <div className="flex items-start gap-2.5">
          <EngineGlyph engine={p.engine} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {connectionLabel(p)}
            </div>
            <div className="truncate font-mono text-[11px] text-faint">{profileAddress(p)}</div>
          </div>
          <button
            aria-label={p.favorite ? 'unfavorite' : 'favorite'}
            aria-pressed={Boolean(p.favorite)}
            className="flex-none rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(e) => {
              e.stopPropagation()
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
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {p.environment && (
            <span className="flex items-center gap-1 rounded bg-surface-2 px-1.5 py-px text-[10px] font-medium text-foreground-soft">
              <span className={`h-1.5 w-1.5 rounded-full ${ENV_DOT[p.environment]}`} />
              {p.environment}
            </span>
          )}
          <span className="rounded bg-surface-2 px-1.5 py-px text-[10px] text-muted-foreground">
            {p.engine}
          </span>
          <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
            {isActive ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                Connected
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-faint/60" />
                Idle
              </>
            )}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Rail */}
      <div className="flex w-52 flex-none flex-col gap-4 overflow-auto border-r border-border bg-card p-3">
        <Button className="w-full" onClick={props.onNew}>
          + New connection
        </Button>
        <div>
          <div className="mb-1 px-2 text-[10.5px] font-bold uppercase tracking-wider text-faint">
            Engines
          </div>
          <RailRow
            label="Favorites"
            count={favoriteCount}
            active={favoritesOnly}
            leading={<IconStar className="h-4 w-4 flex-none fill-warning text-warning" />}
            onClick={() => {
              setFavoritesOnly((v) => !v)
              setEngine(null)
            }}
          />
          <RailRow
            label="All engines"
            count={profiles.length}
            active={engine === null && !favoritesOnly}
            leading={<IconDatabase className="h-4 w-4 flex-none text-muted-foreground" />}
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
              leading={<EngineGlyph engine={eng} />}
              onClick={() => {
                setEngine(engine === eng ? null : eng)
                setFavoritesOnly(false)
              }}
            />
          ))}
        </div>
        <div>
          <div className="mb-1 px-2 text-[10.5px] font-bold uppercase tracking-wider text-faint">
            Environments
          </div>
          {ENVIRONMENTS.map((env) => (
            <RailRow
              key={env}
              label={env[0]!.toUpperCase() + env.slice(1)}
              active={environment === env}
              leading={<span className={`h-2 w-2 flex-none rounded-full ${ENV_DOT[env]}`} />}
              onClick={() => setEnvironment(environment === env ? null : env)}
            />
          ))}
        </div>
      </div>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto bg-surface-2 p-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-foreground">Connections</h1>
          <span className="rounded bg-surface-3 px-1.5 py-px text-[11px] text-muted-foreground">
            {shown.length} of {profiles.length}
          </span>
          <input
            className="ml-auto w-64 min-w-0 rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
            placeholder="Search connections…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {profiles.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <IconDatabase className="h-8 w-8 text-faint" />
            <span>No connections yet — create one with the panel on the left.</span>
          </div>
        )}
        {profiles.length > 0 && shown.length === 0 && (
          <div className="p-6 text-center text-muted-foreground">No connections match.</div>
        )}
        {sections.map(({ env, items }) => (
          <div key={env ?? 'untagged'}>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {env && <span className={`h-1.5 w-1.5 rounded-full ${ENV_DOT[env]}`} />}
              {env ?? 'Other'}
              <span className="font-normal text-faint">{items.length}</span>
            </div>
            <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">{items.map(Card)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Right details panel for a selected (not necessarily connected) profile:
 *  Connect + Edit actions, non-secret key-value rows. Per the Dialect design
 *  the panel is where connecting happens. */
export function ConnectionDetails(props: {
  profile: ConnectionProfile
  onConnect: (connectionId: string, profileId: string, database: string | null) => void
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  const p = props.profile
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setOverlay = useUiStore((s) => s.setConnecting)
  async function connect(): Promise<void> {
    if (connecting) return
    setConnecting(true)
    setError(null)
    setOverlay({ label: connectionLabel(p), host: profileAddress(p) })
    try {
      const connectionId = await window.fordb.connection.open(p.id)
      props.onConnect(connectionId, p.id, p.engine === 'postgres' ? p.database : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnecting(false)
      setOverlay(null)
    }
  }

  const rows: [string, string][] = []
  if (p.engine === 'postgres') {
    rows.push(
      ['Host', p.host],
      ['Port', String(p.port)],
      ['Database', p.database],
      ['User', p.user],
      ['SSL / TLS', p.ssl ? 'require' : 'off']
    )
  } else if (p.engine === 'sqlite') {
    if (p.kind === 'local') rows.push(['File', p.file])
    else if (p.kind === 'remote') rows.push(['URL', p.url])
    else rows.push(['File', p.file], ['Sync URL', p.syncUrl])
  } else {
    if (p.host) rows.push(['Host', p.host], ['Port', String(p.port ?? 27017)])
    if (p.database) rows.push(['Database', p.database])
    if (p.user) rows.push(['User', p.user])
    rows.push(['TLS', p.tls ? 'on' : 'off'])
  }
  if (p.environment) rows.push(['Environment', p.environment])

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-5">
      <div className="flex items-center gap-3">
        <EngineGlyph engine={p.engine} size="lg" />
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-foreground">{connectionLabel(p)}</div>
          <div className="text-xs text-muted-foreground">{p.engine}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button className="flex-1" onClick={() => void connect()} disabled={connecting}>
          <span className="flex items-center gap-1.5">
            <IconPlugConnected className="h-4 w-4" />
            <span>{connecting ? 'Connecting…' : 'Connect'}</span>
          </span>
        </Button>
        <Button variant="outline" onClick={props.onEdit} aria-label="Edit connection">
          Edit
        </Button>
      </div>
      {error && (
        <div className="rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</div>
      )}
      <div className="divide-y divide-border-soft rounded-lg border border-border">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-3 py-2 text-sm">
            <span className="text-muted-foreground">{k}</span>
            <span className="max-w-[60%] truncate font-mono text-xs text-foreground-soft">{v}</span>
          </div>
        ))}
      </div>
      <button
        className="mt-auto self-start rounded px-1 text-xs text-muted-foreground hover:text-destructive"
        onClick={props.onDelete}
      >
        Delete connection…
      </button>
    </div>
  )
}

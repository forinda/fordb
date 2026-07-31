import { useMemo, useState } from 'react'
import IconDatabase from '~icons/lucide/database'
import IconStar from '~icons/lucide/star'
import IconPlugConnected from '~icons/lucide/plug-zap'
import IconChevronRight from '~icons/lucide/chevron-right'
import IconChevronDown from '~icons/lucide/chevron-down'
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

/** Engine glyph badge: colored tile + 2-letter glyph. */
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
      title={props.engine}
      className={`inline-flex flex-none items-center justify-center font-extrabold text-white ${size} ${m.cls}`}
    >
      {m.glyph}
    </span>
  )
}

/** Non-secret address line for a profile. */
export function profileAddress(p: ConnectionProfile): string {
  if (p.engine === 'postgres') return `${p.host}:${p.port}`
  if (p.engine === 'sqlite')
    return p.kind === 'local' ? p.file : p.kind === 'remote' ? p.url : p.file
  return p.host ? `${p.host}:${p.port ?? 27017}` : (p.database ?? 'mongodb')
}

/** Non-secret detail rows for the expanded profile. */
function detailRows(p: ConnectionProfile): [string, string][] {
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
  return rows
}

/** Connections manager: one filtered list.
 *
 *  Replaces a three-column layout (208px filter rail · card grid · 340px details
 *  panel) in which both facets were encoded three times over — environment as
 *  rail rows AND section headers AND a per-card chip; engine as rail rows AND
 *  the glyph tile AND a text chip beside that same glyph. Here each is encoded
 *  once: engine is the glyph, environment is the dot.
 *
 *  Selecting a row expands it in place with its non-secret details and actions,
 *  so connecting no longer requires a permanent third column. Double-click or
 *  Enter connects directly.
 *
 *  Exactly one `Connect` button exists at a time (the selected row's) — the e2e
 *  suite drives `click(<name>)` → `click('Connect')` in 25 specs and relies on
 *  that being unambiguous. */
export function ConnectionManager(props: {
  selectedId: string | null
  onSelect: (profile: ConnectionProfile) => void
  onNew: () => void
  onEdit: (profile: ConnectionProfile) => void
  onDelete: (profile: ConnectionProfile) => void
  onConnect: (connectionId: string, profileId: string, database: string | null) => void
}): React.JSX.Element {
  const { data: profiles = [] } = useProfiles()
  const invalidateProfiles = useInvalidateProfiles()
  const activeProfileId = useConnStore((s) => s.activeProfileId)
  const [engine, setEngine] = useState<ConnectionProfile['engine'] | ''>('')
  const [environment, setEnvironment] = useState<Environment | 'unassigned' | ''>('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [search, setSearch] = useState('')

  const filter: ProfileFilter = {
    engine: engine || undefined,
    environment: environment && environment !== 'unassigned' ? environment : undefined,
    favoritesOnly: favoritesOnly || undefined,
    search: search || undefined
  }
  const shown = useMemo(() => {
    const base = filterProfiles(profiles, filter)
    return environment === 'unassigned' ? base.filter((p) => !p.environment) : base
  }, [profiles, filter, environment])

  const filtering = Boolean(engine || environment || favoritesOnly || search)

  function toggleFavorite(p: ConnectionProfile): void {
    // Metadata-only save: empty secretFields → keychain untouched.
    void window.fordb.profiles
      .save({ ...p, favorite: !p.favorite || undefined }, {})
      .then(() => invalidateProfiles())
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-2">
      {/* One header row replaces the whole 208px rail. */}
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2.5">
        <Button onClick={props.onNew}>+ New connection</Button>
        <input
          aria-label="Search connections"
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
          placeholder="Search connections…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Filter by engine"
          className="flex-none rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
          value={engine}
          onChange={(e) => setEngine(e.target.value as ConnectionProfile['engine'] | '')}
        >
          <option value="">All engines</option>
          <option value="postgres">Postgres</option>
          <option value="sqlite">SQLite</option>
          <option value="mongodb">MongoDB</option>
        </select>
        <select
          aria-label="Filter by environment"
          className="flex-none rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
          value={environment}
          onChange={(e) => setEnvironment(e.target.value as Environment | 'unassigned' | '')}
        >
          <option value="">All environments</option>
          {ENVIRONMENTS.map((env) => (
            <option key={env} value={env}>
              {env[0]!.toUpperCase() + env.slice(1)}
            </option>
          ))}
          <option value="unassigned">Unassigned</option>
        </select>
        <button
          aria-label="Show favorites only"
          aria-pressed={favoritesOnly}
          title="Favorites only"
          onClick={() => setFavoritesOnly((v) => !v)}
          className={`flex-none rounded-lg border p-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            favoritesOnly ? 'border-primary bg-primary/10' : 'border-border hover:bg-surface-2'
          }`}
        >
          <IconStar
            className={`h-4 w-4 ${favoritesOnly ? 'fill-warning text-warning' : 'text-faint'}`}
          />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {profiles.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <IconDatabase className="h-8 w-8 text-faint" />
            {/* Must not contain the literal "+ New connection" — the e2e suite
                selects that button by substring text in 27 specs. */}
            <span>No connections yet — add one to get started.</span>
          </div>
        ) : shown.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No connections match.</div>
        ) : (
          <ul className="divide-y divide-border-soft">
            {shown.map((p) => (
              <ConnectionRow
                key={p.id}
                profile={p}
                selected={p.id === props.selectedId}
                active={p.id === activeProfileId}
                onSelect={() => props.onSelect(p)}
                onToggleFavorite={() => toggleFavorite(p)}
                onEdit={() => props.onEdit(p)}
                onDelete={() => props.onDelete(p)}
                onConnect={props.onConnect}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Count only while a filter narrows the list — a permanent "N of M" chip
          is noise when it always reads "7 of 7". */}
      {filtering && shown.length > 0 && (
        <div className="flex-none border-t border-border px-4 py-1 text-[11px] text-muted-foreground">
          {shown.length} of {profiles.length}
        </div>
      )}
    </div>
  )
}

function ConnectionRow(props: {
  profile: ConnectionProfile
  selected: boolean
  active: boolean
  onSelect: () => void
  onToggleFavorite: () => void
  onEdit: () => void
  onDelete: () => void
  onConnect: (connectionId: string, profileId: string, database: string | null) => void
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

  const Chevron = props.selected ? IconChevronDown : IconChevronRight

  return (
    <li className={props.selected ? 'bg-card' : 'hover:bg-card/60'}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={props.selected}
        onClick={props.onSelect}
        // Double-click and Enter connect outright — the primary action no
        // longer costs a trip through a separate details panel.
        onDoubleClick={() => void connect()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void connect()
          if (e.key === ' ') {
            e.preventDefault()
            props.onSelect()
          }
        }}
        className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <Chevron className="h-3.5 w-3.5 flex-none text-faint" />
        {/* Engine: the glyph, and only the glyph. */}
        <EngineGlyph engine={p.engine} />
        {/* Environment: the dot, and only the dot. */}
        <span
          title={p.environment ?? 'no environment'}
          className={`h-2 w-2 flex-none rounded-full ${
            p.environment ? ENV_DOT[p.environment] : 'bg-faint/40'
          }`}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {connectionLabel(p)}
        </span>
        <span className="hidden min-w-0 max-w-[45%] truncate font-mono text-[11px] text-faint sm:block">
          {profileAddress(p)}
        </span>
        {/* Absence means idle — an "Idle" pill on every row is noise. */}
        {props.active && (
          <span className="flex flex-none items-center gap-1 rounded bg-success/15 px-1.5 py-px text-[10px] font-medium text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Connected
          </span>
        )}
        <button
          aria-label={p.favorite ? 'unfavorite' : 'favorite'}
          aria-pressed={Boolean(p.favorite)}
          className="flex-none rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(e) => {
            e.stopPropagation()
            props.onToggleFavorite()
          }}
        >
          <IconStar
            className={`h-4 w-4 ${
              p.favorite ? 'fill-warning text-warning' : 'text-faint hover:text-warning'
            }`}
          />
        </button>
      </div>

      {props.selected && (
        <div className="px-4 pb-3 pl-[3.25rem]">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Button onClick={() => void connect()} disabled={connecting}>
              <span className="flex items-center gap-1.5">
                <IconPlugConnected className="h-4 w-4" />
                <span>{connecting ? 'Connecting…' : 'Connect'}</span>
              </span>
            </Button>
            <Button variant="outline" onClick={props.onEdit} aria-label="Edit connection">
              Edit
            </Button>
            <button
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={props.onDelete}
            >
              Delete…
            </button>
          </div>
          {error && (
            <div className="mb-2 rounded bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            {detailRows(p).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="truncate font-mono text-foreground-soft">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </li>
  )
}

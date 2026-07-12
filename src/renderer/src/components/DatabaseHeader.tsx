import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import IconDatabase from '~icons/lucide/database'
import { buildDdl } from '@shared/ddl/build-ddl'
import type { SchemaOps } from '@shared/adapter/schema-types'
import { hostApi } from '../rpc'
import { useConnStore } from '../store'
import { useProfiles } from '../query/profiles'
import { useQueryStore } from '../store-query'

/** Database-level header in the sidebar: labels the active database (the level
 *  cue), lets you switch when the server exposes more than one, and hosts
 *  database-scoped actions (New schema). Switching = reopen the same profile
 *  against another database (a live connection can't change db). */
export function DatabaseHeader(): React.JSX.Element | null {
  const connId = useConnStore((s) => s.activeConnectionId)
  const profileId = useConnStore((s) => s.activeProfileId)
  const activeDatabase = useConnStore((s) => s.activeDatabase)
  const setActive = useConnStore((s) => s.setActive)
  const applyDdl = useQueryStore((s) => s.applyDdl)

  const { data: profiles = [] } = useProfiles()
  const dialect: 'pg' | 'sqlite' =
    profiles.find((p) => p.id === profileId)?.engine === 'postgres' ? 'pg' : 'sqlite'

  const { data: dbs = [] } = useQuery({
    queryKey: connId
      ? (['conn', connId, 'databases'] as const)
      : (['conn', 'none', 'databases'] as const),
    queryFn: async () => (await hostApi()).listDatabases(connId!),
    enabled: !!connId
  })
  const { data: ops } = useQuery({
    queryKey: connId ? ['conn', connId, 'schemaOps'] : ['conn', 'none', 'schemaOps'],
    queryFn: async (): Promise<SchemaOps | undefined> => {
      const api = await hostApi()
      return (await api.schemaEditSupported(connId!)) ? api.schemaOps(connId!) : undefined
    },
    enabled: !!connId
  })

  const [menuOpen, setMenuOpen] = useState(false)
  const [newSchema, setNewSchema] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function switchTo(db: string): Promise<void> {
    if (!profileId || db === activeDatabase) return
    const old = connId
    const newId = await window.fordb.connection.open(profileId, db)
    setActive(newId, profileId, db)
    if (old) void window.fordb.connection.close(old)
  }

  async function createSchema(): Promise<void> {
    const n = name.trim()
    if (!n) return
    const stmts = buildDdl({ kind: 'createSchema', name: n }, dialect)
    setNewSchema(false)
    setName('')
    if (!window.confirm(`Apply this DDL?\n\n${stmts.join(';\n')}`)) return
    setError(null)
    try {
      await applyDdl(stmts)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!activeDatabase) return null
  const canSwitch = dbs.length >= 2

  return (
    <div className="border-b border-border">
      <div className="relative flex items-center gap-1.5 px-2 py-1.5">
        <IconDatabase
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-label="database"
        />
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Database</span>
        {canSwitch ? (
          <select
            aria-label="database-switch"
            className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-xs text-foreground"
            value={activeDatabase}
            onChange={(e) => void switchTo(e.target.value)}
          >
            {!dbs.includes(activeDatabase) && (
              <option value={activeDatabase}>{activeDatabase}</option>
            )}
            {dbs.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {activeDatabase}
          </span>
        )}
        {ops?.createSchema && (
          <button
            aria-label="database-actions"
            title="Database actions"
            className="shrink-0 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>
        )}
        {menuOpen && ops?.createSchema && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-2 top-full z-50 mt-1 min-w-40 rounded border border-border bg-background py-1 text-sm shadow-md">
              <button
                className="block w-full px-3 py-1 text-left text-foreground hover:bg-muted"
                onClick={() => {
                  setMenuOpen(false)
                  setNewSchema(true)
                }}
              >
                New schema…
              </button>
            </div>
          </>
        )}
      </div>
      {newSchema && (
        <div className="flex items-center gap-1 px-2 pb-1.5">
          <input
            aria-label="new-schema-name"
            autoFocus
            className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-xs"
            placeholder="new schema name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createSchema()
              if (e.key === 'Escape') {
                setNewSchema(false)
                setName('')
              }
            }}
          />
          <button
            className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground"
            onClick={() => void createSchema()}
          >
            Create
          </button>
        </div>
      )}
      {error && <div className="px-2 pb-1.5 text-xs text-destructive">{error}</div>}
    </div>
  )
}

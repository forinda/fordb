import { useQuery } from '@tanstack/react-query'
import IconDatabase from '~icons/lucide/database'
import { hostApi } from '../rpc'
import { useConnStore } from '../store'

/** Database-level header in the sidebar: labels the active database (the level
 *  cue) and, when the server exposes more than one, lets you switch. Switching =
 *  reopen the same profile against another database (a live connection can't
 *  change db), then close the old one. */
export function DatabaseHeader(): React.JSX.Element | null {
  const connId = useConnStore((s) => s.activeConnectionId)
  const profileId = useConnStore((s) => s.activeProfileId)
  const activeDatabase = useConnStore((s) => s.activeDatabase)
  const setActive = useConnStore((s) => s.setActive)

  const { data: dbs = [] } = useQuery({
    queryKey: connId
      ? (['conn', connId, 'databases'] as const)
      : (['conn', 'none', 'databases'] as const),
    queryFn: async () => (await hostApi()).listDatabases(connId!),
    enabled: !!connId
  })

  async function switchTo(db: string): Promise<void> {
    if (!profileId || db === activeDatabase) return
    const old = connId
    const newId = await window.fordb.connection.open(profileId, db)
    setActive(newId, profileId, db)
    if (old) void window.fordb.connection.close(old)
  }

  // Nothing to label until we know the active database.
  if (!activeDatabase) return null
  const canSwitch = dbs.length >= 2

  return (
    <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
      <IconDatabase className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="database" />
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
    </div>
  )
}

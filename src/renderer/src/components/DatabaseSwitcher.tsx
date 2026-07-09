import { useQuery } from '@tanstack/react-query'
import { hostApi } from '../rpc'
import { useConnStore } from '../store'

/** Lists databases on the connected server and switches between them. Switching
 *  = reopen the same profile against a different database (a live connection
 *  can't change db), then close the old one. Hidden when the engine exposes a
 *  single database (e.g. SQLite). */
export function DatabaseSwitcher(): React.JSX.Element | null {
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

  if (dbs.length < 2) return null

  return (
    <label className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
      DB
      <select
        className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-foreground"
        value={activeDatabase ?? ''}
        onChange={(e) => void switchTo(e.target.value)}
      >
        {activeDatabase && !dbs.includes(activeDatabase) && (
          <option value={activeDatabase}>{activeDatabase}</option>
        )}
        {dbs.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </label>
  )
}

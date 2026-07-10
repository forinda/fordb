import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { MongoSnapshot } from '@shared/adapter/mongo-stats-types'
import { hostApi } from '../rpc'
import { qk } from './keys'

/** Whether the connection's engine exposes the Mongo server-status dashboard
 *  (MongoDB yes, Postgres/SQLite no — those use `useServerStatsSupported`
 *  instead). One-shot — no polling. Used to swap in `MongoDashboard` for the
 *  PG `ServerDashboard`. */
export function useMongoStatsSupported(connId: string | null): UseQueryResult<boolean> {
  return useQuery({
    queryKey: connId
      ? (['conn', connId, 'mongoStatsSupported'] as const)
      : (['conn', 'none', 'mongoStatsSupported'] as const),
    queryFn: async () => (await hostApi()).mongoStatsSupported(connId!),
    enabled: !!connId
  })
}

interface PollOpts {
  intervalMs: number
  enabled: boolean
}

/** Polled Mongo `serverStatus()` snapshot — mirrors `useServerSnapshot`
 *  (query/stats.ts). Callers derive opcounter rates themselves since the
 *  counters are cumulative (see `shared/stats/mongo-rates.ts`). */
export function useMongoSnapshot(
  connId: string | null,
  opts: PollOpts
): UseQueryResult<MongoSnapshot> {
  const on = !!connId && opts.enabled
  return useQuery({
    queryKey: connId ? qk.mongoSnapshot(connId) : ['conn', 'none', 'mongoSnapshot'],
    queryFn: async () => (await hostApi()).mongoServerStatus(connId!),
    enabled: on,
    refetchInterval: on ? opts.intervalMs : false
  })
}

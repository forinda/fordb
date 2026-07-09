import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { ServerSnapshot, SessionRow, LockRow } from '@shared/adapter/stats-types'
import { hostApi } from '../rpc'
import { qk } from './keys'

/** Whether the connection's engine exposes server stats (Postgres yes, SQLite
 *  no). One-shot — no polling. Used to hide the Dashboard tab. */
export function useServerStatsSupported(connId: string | null): UseQueryResult<boolean> {
  return useQuery({
    queryKey: connId
      ? (['conn', connId, 'statsSupported'] as const)
      : (['conn', 'none', 'statsSupported'] as const),
    queryFn: async () => (await hostApi()).serverStatsSupported(connId!),
    enabled: !!connId
  })
}

interface PollOpts {
  intervalMs: number
  enabled: boolean
}

export function useServerSnapshot(
  connId: string | null,
  opts: PollOpts
): UseQueryResult<ServerSnapshot> {
  const on = !!connId && opts.enabled
  return useQuery({
    queryKey: connId ? qk.serverSnapshot(connId) : ['conn', 'none', 'serverSnapshot'],
    queryFn: async () => (await hostApi()).getServerSnapshot(connId!),
    enabled: on,
    refetchInterval: on ? opts.intervalMs : false
  })
}

export function useSessions(connId: string | null, opts: PollOpts): UseQueryResult<SessionRow[]> {
  const on = !!connId && opts.enabled
  return useQuery({
    queryKey: connId ? qk.sessions(connId) : ['conn', 'none', 'sessions'],
    queryFn: async () => (await hostApi()).getSessions(connId!),
    enabled: on,
    refetchInterval: on ? opts.intervalMs : false
  })
}

export function useLocks(connId: string | null, opts: PollOpts): UseQueryResult<LockRow[]> {
  const on = !!connId && opts.enabled
  return useQuery({
    queryKey: connId ? qk.locks(connId) : ['conn', 'none', 'locks'],
    queryFn: async () => (await hostApi()).getLocks(connId!),
    enabled: on,
    refetchInterval: on ? opts.intervalMs : false
  })
}

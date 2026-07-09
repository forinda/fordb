import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { ServerSnapshot, SessionRow, LockRow } from '@shared/adapter/stats-types'
import { hostApi } from '../rpc'
import { qk } from './keys'

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

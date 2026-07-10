import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { hostApi } from '../rpc'

/** Whether the connection's engine exposes server administration (Postgres
 *  yes, SQLite no). One-shot — no polling. Gates the admin UI. */
export function useServerAdminSupported(connId: string | null): UseQueryResult<boolean> {
  return useQuery({
    queryKey: connId
      ? (['conn', connId, 'adminSupported'] as const)
      : (['conn', 'none', 'adminSupported'] as const),
    queryFn: async () => (await hostApi()).serverAdminSupported(connId!),
    enabled: !!connId
  })
}

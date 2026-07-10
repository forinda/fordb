import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { RoleInfo, GrantInfo, SettingRow } from '@shared/adapter/admin-types'
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

/** Roles + attributes + memberships. One-shot. */
export function useRoles(connId: string | null): UseQueryResult<RoleInfo[]> {
  return useQuery({
    queryKey: ['conn', connId ?? 'none', 'roles'] as const,
    queryFn: async () => (await hostApi()).listRoles(connId!),
    enabled: !!connId
  })
}

/** Table grants for a selected role. Enabled only once a role is picked. */
export function useRoleGrants(
  connId: string | null,
  role: string | null
): UseQueryResult<GrantInfo[]> {
  return useQuery({
    queryKey: ['conn', connId ?? 'none', 'roleGrants', role ?? 'none'] as const,
    queryFn: async () => (await hostApi()).roleGrants(connId!, role!),
    enabled: !!connId && !!role
  })
}

/** Read-only pg_settings. One-shot. */
export function useServerSettings(connId: string | null): UseQueryResult<SettingRow[]> {
  return useQuery({
    queryKey: ['conn', connId ?? 'none', 'settings'] as const,
    queryFn: async () => (await hostApi()).serverSettings(connId!),
    enabled: !!connId
  })
}

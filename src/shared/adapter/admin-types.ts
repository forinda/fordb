export interface RoleInfo {
  name: string
  canLogin: boolean
  superuser: boolean
  createRole: boolean
  createDb: boolean
  replication: boolean
  memberOf: string[]
}
export interface GrantInfo {
  schema: string
  table: string
  privilege: string
  grantor: string | null
}
export interface SettingRow {
  name: string
  value: string
  unit: string | null
  category: string | null
  description: string | null
}
/** Optional server-administration capability (Postgres). */
export interface ServerAdmin {
  cancelBackend(pid: number): Promise<boolean>
  terminateBackend(pid: number): Promise<boolean>
  listRoles(): Promise<RoleInfo[]>
  roleGrants(role: string): Promise<GrantInfo[]>
  serverSettings(): Promise<SettingRow[]>
}

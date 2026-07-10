import type pg from 'pg'
import type { GrantInfo, RoleInfo, ServerAdmin, SettingRow } from '@shared/adapter/admin-types'
import * as SQL from './admin-sql'

/** Postgres server administration on the already-authenticated connection. The
 *  DB enforces who may cancel/terminate/see roles; pids/role names are bound. */
export class PgServerAdmin implements ServerAdmin {
  constructor(private readonly conn: () => pg.Client) {}

  private async bool(sql: string, pid: number): Promise<boolean> {
    const r = await this.conn().query(sql, [pid])
    return Boolean((r.rows[0] as { ok?: boolean } | undefined)?.ok)
  }
  cancelBackend(pid: number): Promise<boolean> {
    return this.bool(SQL.CANCEL, pid)
  }
  terminateBackend(pid: number): Promise<boolean> {
    return this.bool(SQL.TERMINATE, pid)
  }
  async listRoles(): Promise<RoleInfo[]> {
    return (await this.conn().query(SQL.LIST_ROLES)).rows as RoleInfo[]
  }
  async roleGrants(role: string): Promise<GrantInfo[]> {
    return (await this.conn().query(SQL.ROLE_GRANTS, [role])).rows as GrantInfo[]
  }
  async serverSettings(): Promise<SettingRow[]> {
    return (await this.conn().query(SQL.SETTINGS)).rows as SettingRow[]
  }
}

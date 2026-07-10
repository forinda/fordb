import type { Client } from '@libsql/client'
import type { ObjectBrowser, ObjectKind, ObjectSummary } from '@shared/adapter/object-types'
import * as SQL from './sqlite-sql'

/** SQLite exposes views + triggers (from sqlite_master); no stored functions. */
export class SqliteObjectBrowser implements ObjectBrowser {
  readonly kinds = ['view', 'trigger'] as const
  constructor(private readonly conn: () => Client) {}

  // The kind reaches here over RPC, so TS's union type is not enforced at
  // runtime — validate against the literal set before it is interpolated into
  // the sqlite_master WHERE (defense in depth for the one interpolated field).
  private sqliteType(kind: ObjectKind): 'view' | 'trigger' | null {
    return kind === 'view' || kind === 'trigger' ? kind : null
  }

  async list(schema: string, kind: ObjectKind): Promise<ObjectSummary[]> {
    const type = this.sqliteType(kind)
    if (!type) return []
    const rs = await this.conn().execute(SQL.listObjects(schema, type))
    return (rs.rows as unknown as { name: string }[]).map((r) => ({ name: String(r.name) }))
  }
  async definition(schema: string, kind: ObjectKind, name: string): Promise<string> {
    const type = this.sqliteType(kind)
    if (!type) return ''
    const rs = await this.conn().execute({
      sql: SQL.objectDefinition(schema, type),
      args: [name]
    })
    return String((rs.rows[0] as unknown as { sql?: string } | undefined)?.sql ?? '')
  }
}

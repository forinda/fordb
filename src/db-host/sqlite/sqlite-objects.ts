import type { Client } from '@libsql/client'
import type { ObjectBrowser, ObjectKind, ObjectSummary } from '@shared/adapter/object-types'
import * as SQL from './sqlite-sql'

/** SQLite exposes views + triggers (from sqlite_master); no stored functions. */
export class SqliteObjectBrowser implements ObjectBrowser {
  readonly kinds = ['view', 'trigger'] as const
  constructor(private readonly conn: () => Client) {}

  async list(schema: string, kind: ObjectKind): Promise<ObjectSummary[]> {
    if (kind === 'function') return []
    const rs = await this.conn().execute(SQL.listObjects(schema, kind))
    return (rs.rows as unknown as { name: string }[]).map((r) => ({ name: String(r.name) }))
  }
  async definition(schema: string, kind: ObjectKind, name: string): Promise<string> {
    if (kind === 'function') return ''
    const rs = await this.conn().execute({
      sql: SQL.objectDefinition(schema, kind),
      args: [name]
    })
    return String((rs.rows[0] as unknown as { sql?: string } | undefined)?.sql ?? '')
  }
}

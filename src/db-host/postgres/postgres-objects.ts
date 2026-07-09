import type pg from 'pg'
import type { ObjectBrowser, ObjectKind, ObjectSummary } from '@shared/adapter/object-types'
import * as SQL from './introspection-sql'

const LIST: Record<ObjectKind, string> = {
  view: SQL.LIST_VIEWS,
  function: SQL.LIST_FUNCTIONS,
  trigger: SQL.LIST_TRIGGERS
}
const DEF: Record<ObjectKind, string> = {
  view: SQL.DEF_VIEW,
  function: SQL.DEF_FUNCTION,
  trigger: SQL.DEF_TRIGGER
}

export class PgObjectBrowser implements ObjectBrowser {
  readonly kinds = ['view', 'function', 'trigger'] as const
  constructor(private readonly conn: () => pg.Client) {}

  async list(schema: string, kind: ObjectKind): Promise<ObjectSummary[]> {
    const r = await this.conn().query(LIST[kind], [schema])
    return (r.rows as { name: string }[]).map((x) => ({ name: String(x.name) }))
  }
  async definition(schema: string, kind: ObjectKind, name: string): Promise<string> {
    const r = await this.conn().query(DEF[kind], [schema, name])
    return String((r.rows[0] as { def?: string } | undefined)?.def ?? '')
  }
}

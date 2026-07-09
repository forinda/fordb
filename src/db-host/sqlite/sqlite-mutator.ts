import type { Client, InStatement, InValue } from '@libsql/client'
import type { DataMutator, RowEdit } from '@shared/adapter/mutation-types'
import { quoteIdent } from '@shared/mutation/build-edits'

function statement(e: RowEdit): InStatement {
  const t = `${quoteIdent(e.schema)}.${quoteIdent(e.table)}`
  const args: InValue[] = []
  const bind = (v: unknown): string => {
    args.push(v as InValue)
    return '?'
  }
  if (e.kind === 'update') {
    const set = e.set.map((c) => `${quoteIdent(c.column)} = ${bind(c.value)}`).join(', ')
    const where = e.pk.map((c) => `${quoteIdent(c.column)} = ${bind(c.value)}`).join(' AND ')
    return { sql: `UPDATE ${t} SET ${set} WHERE ${where}`, args }
  }
  if (e.kind === 'insert') {
    const cols = e.values.map((c) => quoteIdent(c.column)).join(', ')
    const vals = e.values.map((c) => bind(c.value)).join(', ')
    return { sql: `INSERT INTO ${t} (${cols}) VALUES (${vals})`, args }
  }
  const where = e.pk.map((c) => `${quoteIdent(c.column)} = ${bind(c.value)}`).join(' AND ')
  return { sql: `DELETE FROM ${t} WHERE ${where}`, args }
}

export class SqliteDataMutator implements DataMutator {
  constructor(private readonly conn: () => Client) {}

  async apply(edits: RowEdit[]): Promise<void> {
    // libsql batch(..., 'write') runs the statements in a single transaction and
    // rolls back on any failure.
    await this.conn().batch(edits.map(statement), 'write')
  }
}

import type pg from 'pg'
import type { DataMutator, RowEdit } from '@shared/adapter/mutation-types'
import { quoteIdent } from '@shared/mutation/build-edits'

/** Builds a parameterized statement ($1…) + ordered params for one edit. */
function statement(e: RowEdit): { text: string; params: unknown[] } {
  const t = `${quoteIdent(e.schema)}.${quoteIdent(e.table)}`
  const params: unknown[] = []
  const bind = (v: unknown): string => `$${params.push(v)}`
  if (e.kind === 'update') {
    const set = e.set.map((c) => `${quoteIdent(c.column)} = ${bind(c.value)}`).join(', ')
    const where = e.pk.map((c) => `${quoteIdent(c.column)} = ${bind(c.value)}`).join(' AND ')
    return { text: `UPDATE ${t} SET ${set} WHERE ${where}`, params }
  }
  if (e.kind === 'insert') {
    const cols = e.values.map((c) => quoteIdent(c.column)).join(', ')
    const vals = e.values.map((c) => bind(c.value)).join(', ')
    return { text: `INSERT INTO ${t} (${cols}) VALUES (${vals})`, params }
  }
  const where = e.pk.map((c) => `${quoteIdent(c.column)} = ${bind(c.value)}`).join(' AND ')
  return { text: `DELETE FROM ${t} WHERE ${where}`, params }
}

export class PgDataMutator implements DataMutator {
  constructor(private readonly conn: () => pg.Client) {}

  async apply(edits: RowEdit[]): Promise<void> {
    const c = this.conn()
    await c.query('BEGIN')
    try {
      for (const e of edits) {
        const { text, params } = statement(e)
        await c.query(text, params)
      }
      await c.query('COMMIT')
    } catch (err) {
      await c.query('ROLLBACK')
      throw err
    }
  }
}

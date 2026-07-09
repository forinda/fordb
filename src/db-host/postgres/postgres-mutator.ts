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
  // Opens a DEDICATED connection per apply — never the shared query client. The
  // data tab's SELECT leaves a pg-cursor open (only page 1 loaded), and node-pg
  // won't dispatch a queued BEGIN until that cursor drains/closes; a BEGIN on
  // the shared client would hang indefinitely. A fresh connection sidesteps it
  // entirely (same approach as PostgresAdapter.cancel()'s side connection).
  constructor(private readonly makeClient: () => pg.Client) {}

  async apply(edits: RowEdit[]): Promise<void> {
    const c = this.makeClient()
    await c.connect()
    try {
      await c.query('BEGIN')
      for (const e of edits) {
        const { text, params } = statement(e)
        await c.query(text, params)
      }
      await c.query('COMMIT')
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      await c.end()
    }
  }
}

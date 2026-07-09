import type pg from 'pg'
import type { SchemaEditor, SchemaOps } from '@shared/adapter/schema-types'

const PG_OPS: SchemaOps = {
  createTable: true,
  addColumn: true,
  createIndex: true,
  dropIndex: true,
  addForeignKey: true,
  dropForeignKey: true,
  dropTable: true,
  createSchema: true,
  dropSchema: true,
  createDatabase: true,
  dropDatabase: true
}

// CREATE/DROP DATABASE cannot run inside a transaction block.
const isDatabaseStmt = (s: string): boolean => /^\s*(CREATE|DROP)\s+DATABASE\b/i.test(s)

export class PgSchemaEditor implements SchemaEditor {
  readonly ops = PG_OPS
  // Dedicated client per apply (same rationale as PgDataMutator: never queue a
  // transaction behind an open query/browse cursor on the shared connection).
  constructor(private readonly makeClient: () => pg.Client) {}

  async applyDdl(statements: string[]): Promise<void> {
    if (statements.length === 0) return
    const client = this.makeClient()
    await client.connect()
    try {
      const inTxn = !statements.some(isDatabaseStmt)
      if (inTxn) await client.query('BEGIN')
      try {
        for (const s of statements) await client.query(s)
        if (inTxn) await client.query('COMMIT')
      } catch (err) {
        if (inTxn) await client.query('ROLLBACK').catch(() => {})
        throw err
      }
    } finally {
      await client.end()
    }
  }
}

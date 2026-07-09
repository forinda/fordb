import type { Client } from '@libsql/client'
import type { SchemaEditor, SchemaOps } from '@shared/adapter/schema-types'

// SQLite can do these without a table rebuild. FK/schema/database ops and
// in-place column changes need a rebuild → deferred to MA3b, advertised false.
const SQLITE_OPS: SchemaOps = {
  createTable: true,
  addColumn: true,
  createIndex: true,
  dropIndex: true,
  dropTable: true,
  addForeignKey: false,
  dropForeignKey: false,
  createSchema: false,
  dropSchema: false,
  createDatabase: false,
  dropDatabase: false
}

export class SqliteSchemaEditor implements SchemaEditor {
  readonly ops = SQLITE_OPS
  constructor(private readonly conn: () => Client) {}

  async applyDdl(statements: string[]): Promise<void> {
    if (statements.length === 0) return
    // batch(_, 'write') wraps the statements in a single write transaction.
    await this.conn().batch(statements, 'write')
  }
}

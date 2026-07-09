import type { Client } from '@libsql/client'
import type { SchemaEditor, SchemaOps } from '@shared/adapter/schema-types'

// createSchema/database stay false (no CREATE SCHEMA in SQLite). Rename/drop
// column are native; alterColumn and FK add/drop go through the table-rebuild.
const SQLITE_OPS: SchemaOps = {
  createTable: true,
  addColumn: true,
  renameColumn: true,
  dropColumn: true,
  alterColumn: true,
  createIndex: true,
  dropIndex: true,
  dropTable: true,
  addForeignKey: true,
  dropForeignKey: true,
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

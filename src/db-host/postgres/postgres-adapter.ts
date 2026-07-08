import pg from 'pg'
import Cursor from 'pg-cursor'
import type { DbAdapter } from '../../shared/adapter/db-adapter'
import type {
  ColumnInfo,
  ConnectionProfile,
  IndexInfo,
  KeyInfo,
  OpenQueryResult,
  Page,
  QueryResult,
  TableInfo
} from '../../shared/adapter/types'
import * as SQL from './introspection-sql'

// pg's built-in type parsers don't cover `name[]` (OID 1003) — the array type
// Postgres reports for `ARRAY(SELECT a.attname ...)` in the key/index
// introspection queries (pg_attribute.attname is `name`, not `text`).
// Without this, node-pg returns the raw wire literal (e.g. "{user_id}")
// instead of a parsed string[]. Reuse the text[] (OID 1009) parser, which
// decodes the same array literal format. (@types/pg's TypeId enum only
// covers scalar OIDs, so the array OIDs are held as plain `number`s to
// avoid an unsafe literal cast.)
const NAME_ARRAY_OID: number = 1003
const TEXT_ARRAY_OID: number = 1009
pg.types.setTypeParser(NAME_ARRAY_OID, (value: string) =>
  pg.types.getTypeParser(TEXT_ARRAY_OID)(value)
)

interface OpenCursor {
  cursor: Cursor
  fields: { name: string; dataType: string }[]
  pageSize: number
}

export class PostgresAdapter implements DbAdapter {
  private client: pg.Client | null = null
  private profile: ConnectionProfile | null = null
  private backendPid: number | null = null
  private cursors = new Map<string, OpenCursor>()
  private nextCursorId = 1

  private get conn(): pg.Client {
    if (!this.client) throw new Error('Not connected')
    return this.client
  }

  private static clientConfig(profile: ConnectionProfile): pg.ClientConfig {
    return {
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.user,
      password: profile.password,
      ssl: profile.ssl
        ? {
            ca: profile.ssl.ca,
            cert: profile.ssl.cert,
            key: profile.ssl.key,
            rejectUnauthorized: profile.ssl.rejectUnauthorized
          }
        : undefined
    }
  }

  async connect(profile: ConnectionProfile): Promise<void> {
    const client = new pg.Client(PostgresAdapter.clientConfig(profile))
    await client.connect()
    const pid = await client.query('SELECT pg_backend_pid() AS pid')
    this.backendPid = (pid.rows[0] as { pid: number }).pid
    this.client = client
    this.profile = profile
  }

  async disconnect(): Promise<void> {
    for (const [id] of this.cursors) await this.closeQuery(id)
    await this.client?.end()
    this.client = null
    this.backendPid = null
  }

  async listDatabases(): Promise<string[]> {
    const r = await this.conn.query(SQL.LIST_DATABASES)
    return r.rows.map((row: { datname: string }) => row.datname)
  }

  async listSchemas(): Promise<string[]> {
    const r = await this.conn.query(SQL.LIST_SCHEMAS)
    return r.rows.map((row: { nspname: string }) => row.nspname)
  }

  async listTables(schema: string): Promise<TableInfo[]> {
    const r = await this.conn.query(SQL.LIST_TABLES, [schema])
    return r.rows.map((row: { name: string; type: 'table' | 'view' }) => ({
      schema,
      name: row.name,
      type: row.type
    }))
  }

  async getColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    const r = await this.conn.query(SQL.GET_COLUMNS, [schema, table])
    return r.rows.map((row: ColumnInfo & { ordinal: string | number }) => ({
      ...row,
      ordinal: Number(row.ordinal)
    }))
  }

  async getKeys(schema: string, table: string): Promise<KeyInfo[]> {
    const r = await this.conn.query(SQL.GET_KEYS, [schema, table])
    return r.rows as KeyInfo[]
  }

  async getIndexes(schema: string, table: string): Promise<IndexInfo[]> {
    const r = await this.conn.query(SQL.GET_INDEXES, [schema, table])
    return r.rows as IndexInfo[]
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    const r = await this.conn.query({ text: sql, rowMode: 'array' })
    return {
      fields: r.fields.map((f) => ({ name: f.name, dataType: String(f.dataTypeID) })),
      rows: r.rows as unknown[][],
      rowCount: r.rowCount ?? r.rows.length,
      command: r.command
    }
  }

  async openQuery(_sql: string, _pageSize: number): Promise<OpenQueryResult> {
    throw new Error('not implemented')
  }

  async fetchPage(_queryId: string): Promise<Page> {
    throw new Error('not implemented')
  }

  async closeQuery(_queryId: string): Promise<void> {
    throw new Error('not implemented')
  }

  async cancel(): Promise<void> {
    throw new Error('not implemented')
  }
}

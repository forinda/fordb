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
  // First page of rows, fetched eagerly in openQuery to read field metadata
  // off the pg-cursor result (see openQuery for why `read(0, ...)` can't be
  // used for that purpose). Consumed by the first fetchPage call.
  pending?: unknown[][]
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

  async openQuery(sql: string, pageSize: number): Promise<OpenQueryResult> {
    const cursor = this.conn.query(new Cursor(sql, [], { rowMode: 'array' }))
    // Note: `cursor.read(0, ...)` cannot be used to "prime" the cursor for
    // field metadata without consuming rows — in the Postgres extended query
    // protocol an Execute message's maxRows of 0 means "no limit", so it
    // would eagerly fetch the *entire* result set instead of zero rows.
    // Instead, fetch the first page eagerly here (reading fields off the
    // pg-cursor result callback, which is the public/stable surface — no
    // reliance on the `_result` private field) and stash it for the first
    // fetchPage call to consume.
    const { rows, fields } = await new Promise<{
      rows: unknown[][]
      fields: { name: string; dataType: string }[]
    }>((resolve, reject) =>
      cursor.read(pageSize, (err, r, result) => {
        if (err) {
          reject(err)
          return
        }
        resolve({
          rows: r as unknown[][],
          fields: result.fields.map((f) => ({ name: f.name, dataType: String(f.dataTypeID) }))
        })
      })
    )
    const queryId = `q${this.nextCursorId++}`
    this.cursors.set(queryId, { cursor, fields, pageSize, pending: rows })
    return { queryId, fields }
  }

  async fetchPage(queryId: string): Promise<Page> {
    const open = this.cursors.get(queryId)
    if (!open) throw new Error(`Unknown queryId: ${queryId}`)
    let rows: unknown[][]
    if (open.pending) {
      rows = open.pending
      open.pending = undefined
    } else {
      rows = await new Promise<unknown[][]>((resolve, reject) =>
        open.cursor.read(open.pageSize, (err, r) => (err ? reject(err) : resolve(r as unknown[][])))
      )
    }
    const done = rows.length < open.pageSize
    if (done) await this.closeQuery(queryId)
    return { rows, done }
  }

  async closeQuery(queryId: string): Promise<void> {
    const open = this.cursors.get(queryId)
    if (!open) return
    this.cursors.delete(queryId)
    await new Promise<void>((resolve) => open.cursor.close(() => resolve()))
  }

  async cancel(): Promise<void> {
    if (!this.profile || this.backendPid === null) throw new Error('Not connected')
    const side = new pg.Client(PostgresAdapter.clientConfig(this.profile))
    await side.connect()
    try {
      await side.query('SELECT pg_cancel_backend($1)', [this.backendPid])
    } finally {
      await side.end()
    }
  }
}

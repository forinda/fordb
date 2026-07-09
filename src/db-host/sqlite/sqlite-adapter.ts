import {
  createClient,
  type Client,
  type Config,
  type InValue,
  type ResultSet
} from '@libsql/client'
import type { DbAdapter } from '@shared/adapter/db-adapter'
import type { DataMutator } from '@shared/adapter/mutation-types'
import type { DataBrowser } from '@shared/adapter/browse-types'
import { configFor } from './sqlite-config'
import { SqliteDataMutator } from './sqlite-mutator'
import { SqliteDataBrowser } from './sqlite-browser'
import type {
  ColumnInfo,
  ConnectionProfile,
  FieldInfo,
  IndexInfo,
  KeyInfo,
  OpenQueryResult,
  Page,
  QueryResult,
  TableInfo
} from '@shared/adapter/types'
import * as SQL from './sqlite-sql'

type Row = Record<string, unknown>

// A buffered cursor: libsql has no server-side cursor for a local file, so
// openQuery runs the statement once and pages the in-memory rows by slice.
interface Cursor {
  rows: unknown[][]
  fields: FieldInfo[]
  offset: number
  pageSize: number
}

export class SqliteAdapter implements DbAdapter {
  private client: Client | null = null
  private cursors = new Map<string, Cursor>()
  private nextCursor = 1

  // The libsql client factory is injectable so connect() can be unit-tested
  // without a real database/server.
  constructor(private readonly makeClient: (config: Config) => Client = createClient) {}

  readonly dataMutator: DataMutator = new SqliteDataMutator(() => this.conn)
  readonly dataBrowser: DataBrowser = new SqliteDataBrowser((sql, params, ps) =>
    this.openBuffered(sql, params as InValue[], ps)
  )

  private get conn(): Client {
    if (!this.client) throw new Error('Not connected')
    return this.client
  }

  async connect(profile: ConnectionProfile): Promise<void> {
    if (profile.engine !== 'sqlite') throw new Error('SqliteAdapter requires a sqlite profile')
    const client = this.makeClient(configFor(profile))
    // Embedded replicas pull the remote snapshot down once on connect. If the
    // sync fails (bad token, unreachable syncUrl, network blip), close the
    // just-opened client before rethrowing — otherwise it leaks a file handle
    // and socket (the adapter reference is dropped on a connect throw).
    if (profile.kind === 'replica') {
      try {
        await client.sync()
      } catch (err) {
        client.close()
        throw err
      }
    }
    this.client = client
  }
  async disconnect(): Promise<void> {
    this.client?.close()
    this.client = null
    this.cursors.clear()
  }

  private async rows(sql: string): Promise<Row[]> {
    return (await this.conn.execute(sql)).rows as unknown as Row[]
  }

  async listDatabases(): Promise<string[]> {
    return (await this.rows(SQL.DATABASE_LIST)).map((r) => String(r.name))
  }
  async listSchemas(): Promise<string[]> {
    return this.listDatabases()
  }
  async listTables(schema: string): Promise<TableInfo[]> {
    return (await this.rows(SQL.listTables(schema))).map((r) => ({
      schema,
      name: String(r.name),
      type: r.type === 'view' ? 'view' : 'table'
    }))
  }
  async getColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    return (await this.rows(SQL.tableInfo(schema, table))).map((r) => ({
      name: String(r.name),
      dataType: String(r.type ?? ''),
      nullable: Number(r.notnull) === 0,
      defaultValue: r.dflt_value == null ? null : String(r.dflt_value),
      ordinal: Number(r.cid) + 1
    }))
  }
  async getKeys(schema: string, table: string): Promise<KeyInfo[]> {
    const keys: KeyInfo[] = []
    const cols = await this.rows(SQL.tableInfo(schema, table))
    const pk = cols
      .filter((c) => Number(c.pk) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk))
      .map((c) => String(c.name))
    if (pk.length)
      keys.push({ name: 'primary', kind: 'primary', columns: pk, referencedTable: null })

    const byId = new Map<number, { columns: string[]; ref: string }>()
    for (const r of await this.rows(SQL.foreignKeyList(schema, table))) {
      const id = Number(r.id)
      const e = byId.get(id) ?? { columns: [], ref: String(r.table) }
      e.columns.push(String(r.from))
      byId.set(id, e)
    }
    for (const [id, e] of byId)
      keys.push({ name: `fk_${id}`, kind: 'foreign', columns: e.columns, referencedTable: e.ref })

    for (const idx of await this.rows(SQL.indexList(schema, table))) {
      if (Number(idx.unique) !== 1 || idx.origin !== 'u') continue
      const name = String(idx.name)
      const columns = (await this.rows(SQL.indexInfo(schema, name))).map((r) => String(r.name))
      keys.push({ name, kind: 'unique', columns, referencedTable: null })
    }
    return keys
  }
  async getIndexes(schema: string, table: string): Promise<IndexInfo[]> {
    const out: IndexInfo[] = []
    for (const idx of await this.rows(SQL.indexList(schema, table))) {
      const name = String(idx.name)
      const columns = (await this.rows(SQL.indexInfo(schema, name))).map((r) => String(r.name))
      out.push({ name, columns, unique: Number(idx.unique) === 1 })
    }
    return out
  }

  private static fieldsOf(rs: ResultSet): FieldInfo[] {
    return rs.columns.map((name) => ({ name, dataType: '' }))
  }
  private static arrayRows(rs: ResultSet): unknown[][] {
    const cols = rs.columns
    return (rs.rows as unknown as Row[]).map((r) => cols.map((c) => r[c]))
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    const rs = await this.conn.execute(sql)
    const command = (sql.trim().split(/\s+/)[0] ?? '').toUpperCase()
    // A SELECT reports columns; DML reports rowsAffected and no columns.
    const rowCount = rs.columns.length > 0 ? rs.rows.length : Number(rs.rowsAffected)
    return {
      fields: SqliteAdapter.fieldsOf(rs),
      rows: SqliteAdapter.arrayRows(rs),
      rowCount,
      command
    }
  }

  async openQuery(sql: string, pageSize: number): Promise<OpenQueryResult> {
    return this.openBuffered(sql, [], pageSize)
  }
  private async openBuffered(
    sql: string,
    args: InValue[],
    pageSize: number
  ): Promise<OpenQueryResult> {
    const rs = await this.conn.execute({ sql, args })
    const fields = SqliteAdapter.fieldsOf(rs)
    const id = `c${this.nextCursor++}`
    this.cursors.set(id, { rows: SqliteAdapter.arrayRows(rs), fields, offset: 0, pageSize })
    return { queryId: id, fields }
  }
  async fetchPage(queryId: string): Promise<Page> {
    const cur = this.cursors.get(queryId)
    if (!cur) throw new Error(`Unknown query: ${queryId}`)
    const rows = cur.rows.slice(cur.offset, cur.offset + cur.pageSize)
    cur.offset += rows.length
    const done = cur.offset >= cur.rows.length
    if (done) this.cursors.delete(queryId)
    return { rows, done }
  }
  async closeQuery(queryId: string): Promise<void> {
    this.cursors.delete(queryId)
  }
  async cancel(): Promise<void> {
    // No-op: libsql statements against a local file run to completion; there is
    // no server-side backend to interrupt. Documented adapter limitation.
  }
}

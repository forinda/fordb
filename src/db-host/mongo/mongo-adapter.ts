import { MongoClient, type Db } from 'mongodb'
import type { DbAdapter } from '@shared/adapter/db-adapter'
import type {
  DocumentAdmin,
  DocumentMutator,
  DocumentQuery,
  DocumentUserAdmin
} from '@shared/adapter/document-types'
import type {
  ColumnInfo,
  ConnectionProfile,
  IndexInfo,
  KeyInfo,
  OpenQueryResult,
  Page,
  QueryResult,
  TableInfo
} from '@shared/adapter/types'
import type { MongoStats } from '@shared/adapter/mongo-stats-types'
import { buildMongoUri } from './mongo-config'
import { MongoDocumentQuery } from './mongo-query'
import { MongoDocumentMutator } from './mongo-mutator'
import { MongoDocumentAdmin } from './mongo-admin'
import { MongoUserAdmin } from './mongo-users'
import { MongoServerStats } from './mongo-stats'

const SAMPLE = 100
const NO_SQL = 'MongoDB uses the document query surface, not SQL'

export class MongoAdapter implements DbAdapter {
  private client: MongoClient | null = null
  private dbName = ''
  readonly documentQuery: DocumentQuery = new MongoDocumentQuery((name) => this.dbFor(name))
  readonly documentMutator: DocumentMutator = new MongoDocumentMutator((name) => this.dbFor(name))
  readonly documentAdmin: DocumentAdmin = new MongoDocumentAdmin((name) => this.dbFor(name))
  readonly documentUserAdmin: DocumentUserAdmin = new MongoUserAdmin((name) => this.dbFor(name))
  readonly mongoStats: MongoStats = new MongoServerStats(() => this.database())

  constructor(
    private readonly makeClient: (uri: string) => MongoClient = (u) => new MongoClient(u)
  ) {}

  private get conn(): MongoClient {
    if (!this.client) throw new Error('Not connected')
    return this.client
  }
  private database(): Db {
    return this.conn.db(this.dbName || undefined)
  }
  /** A Db by explicit name (the collection's own database); falls back to the
   *  connection's default when the caller passes an empty name. */
  private dbFor(name: string): Db {
    return this.conn.db(name || this.dbName || undefined)
  }

  async connect(profile: ConnectionProfile): Promise<void> {
    if (profile.engine !== 'mongodb') throw new Error('MongoAdapter requires a mongodb profile')
    const client = this.makeClient(buildMongoUri(profile))
    await client.connect()
    this.client = client
    this.dbName = profile.database ?? client.db().databaseName
  }
  async disconnect(): Promise<void> {
    await (this.documentQuery as MongoDocumentQuery).closeAll()
    await this.client?.close()
    this.client = null
  }

  async listDatabases(): Promise<string[]> {
    const r = await this.conn.db('admin').admin().listDatabases()
    return r.databases.map((d) => d.name)
  }
  listSchemas(): Promise<string[]> {
    return this.listDatabases()
  }
  async listTables(schema: string): Promise<TableInfo[]> {
    const cols = await this.conn.db(schema).listCollections().toArray()
    return cols.map((c) => ({ schema, name: c.name, type: c.type === 'view' ? 'view' : 'table' }))
  }
  async getColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    const docs = await this.conn
      .db(schema)
      .collection(table)
      .aggregate([{ $sample: { size: SAMPLE } }])
      .toArray()
    const seen = new Map<string, string>()
    for (const d of docs)
      for (const [k, v] of Object.entries(d)) if (!seen.has(k)) seen.set(k, bsonType(v))
    return [...seen].map(([name, dataType], i) => ({
      name,
      dataType,
      nullable: true,
      defaultValue: null,
      ordinal: i
    }))
  }
  getKeys(): Promise<KeyInfo[]> {
    return Promise.resolve([
      {
        name: '_id_',
        kind: 'unique',
        columns: ['_id'],
        referencedTable: null,
        referencedColumns: null
      }
    ])
  }
  async getIndexes(schema: string, table: string): Promise<IndexInfo[]> {
    const idx = await this.conn.db(schema).collection(table).listIndexes().toArray()
    return idx.map((ix) => ({
      name: String(ix.name),
      columns: Object.keys(ix.key as Record<string, unknown>),
      unique: Boolean(ix.unique) || ix.name === '_id_'
    }))
  }

  executeQuery(): Promise<QueryResult> {
    return Promise.reject(new Error(NO_SQL))
  }
  openQuery(): Promise<OpenQueryResult> {
    return Promise.reject(new Error(NO_SQL))
  }
  fetchPage(): Promise<Page> {
    return Promise.reject(new Error(NO_SQL))
  }
  closeQuery(): Promise<void> {
    return Promise.resolve()
  }
  async cancel(): Promise<void> {
    await (this.documentQuery as MongoDocumentQuery).closeAll()
  }
}

function bsonType(v: unknown): string {
  if (v == null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (v instanceof Date) return 'date'
  if (typeof v === 'object') return (v as { _bsontype?: string })._bsontype ?? 'object'
  return typeof v
}

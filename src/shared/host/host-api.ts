import type {
  ColumnInfo,
  ConnectionProfile,
  IndexInfo,
  KeyInfo,
  OpenQueryResult,
  Page,
  QueryResult,
  TableInfo
} from '../adapter/types'

export type ConnectionId = string

export type TestResult = { ok: true } | { ok: false; error: string }

/**
 * The RPC target the renderer and main talk to. One HostApi instance per RPC
 * port, all backed by the db-host's single ConnectionRegistry. Secret-bearing
 * methods (test/open) are only ever called over main's privileged control
 * port; the renderer only calls connectionId-addressed methods.
 */
export interface HostApi {
  testConnection(profile: ConnectionProfile): Promise<TestResult>
  openConnection(profile: ConnectionProfile): Promise<ConnectionId>
  closeConnection(id: ConnectionId): Promise<void>

  listDatabases(id: ConnectionId): Promise<string[]>
  listSchemas(id: ConnectionId): Promise<string[]>
  listTables(id: ConnectionId, schema: string): Promise<TableInfo[]>
  getColumns(id: ConnectionId, schema: string, table: string): Promise<ColumnInfo[]>
  getKeys(id: ConnectionId, schema: string, table: string): Promise<KeyInfo[]>
  getIndexes(id: ConnectionId, schema: string, table: string): Promise<IndexInfo[]>

  executeQuery(id: ConnectionId, sql: string): Promise<QueryResult>
  openQuery(id: ConnectionId, sql: string, pageSize: number): Promise<OpenQueryResult>
  fetchPage(id: ConnectionId, queryId: string): Promise<Page>
  closeQuery(id: ConnectionId, queryId: string): Promise<void>
  cancel(id: ConnectionId): Promise<void>
}

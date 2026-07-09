import type {
  ColumnInfo,
  ConnectionProfile,
  IndexInfo,
  KeyInfo,
  OpenQueryResult,
  Page,
  QueryResult,
  TableInfo
} from './types'
import type { ServerStatsProvider } from './stats-types'
import type { DataMutator } from './mutation-types'

/**
 * Contract implemented by every engine adapter (db-host side) and by the
 * renderer RPC proxy. All methods async + JSON-serializable args/returns:
 * this interface crosses a process boundary.
 */
export interface DbAdapter {
  connect(profile: ConnectionProfile): Promise<void>
  disconnect(): Promise<void>

  listDatabases(): Promise<string[]>
  listSchemas(): Promise<string[]>
  /** Tables AND views for a schema; TableInfo.type distinguishes. */
  listTables(schema: string): Promise<TableInfo[]>
  getColumns(schema: string, table: string): Promise<ColumnInfo[]>
  getKeys(schema: string, table: string): Promise<KeyInfo[]>
  getIndexes(schema: string, table: string): Promise<IndexInfo[]>

  /** Buffered execution — small/interactive statements. */
  executeQuery(sql: string): Promise<QueryResult>

  /** Cursor-backed streaming for large results. */
  openQuery(sql: string, pageSize: number): Promise<OpenQueryResult>
  fetchPage(queryId: string): Promise<Page>
  closeQuery(queryId: string): Promise<void>

  /** Cancel the currently running statement on this connection. */
  cancel(): Promise<void>

  /** Optional read-only server-monitoring capability (Postgres implements it). */
  readonly serverStats?: ServerStatsProvider

  /** Optional data-write capability (Postgres + SQLite). */
  readonly dataMutator?: DataMutator
}

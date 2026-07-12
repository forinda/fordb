import type {
  CheckInfo,
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
import type { DataBrowser } from './browse-types'
import type { SchemaEditor } from './schema-types'
import type { ObjectBrowser } from './object-types'
import type { ServerAdmin } from './admin-types'

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
  /** CHECK constraints. Optional: engines without introspection for them (or
   *  where checks don't fit KeyInfo) simply omit it — callers treat it as []. */
  getChecks?(schema: string, table: string): Promise<CheckInfo[]>

  /** Buffered execution — small/interactive statements. */
  executeQuery(sql: string): Promise<QueryResult>

  /** Execute a single row-returning statement in an engine-enforced read-only
   *  mode (Postgres READ ONLY transaction / SQLite query_only). The MCP surface
   *  uses ONLY this path: a write reaching here throws at the engine — the
   *  definitive boundary behind the text classifier. Absent on engines with no
   *  read-only mode (Mongo), so the MCP run_query rejects them. */
  executeReadOnly?(sql: string): Promise<QueryResult>

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

  /** Optional structured-browse capability (Postgres + SQLite). */
  readonly dataBrowser?: DataBrowser

  /** Optional structure/DDL capability (Postgres full; SQLite non-rebuild ops). */
  readonly schemaEditor?: SchemaEditor

  /** Optional object browser (views/functions/triggers). */
  readonly objects?: ObjectBrowser

  /** Optional server-administration capability (Postgres). */
  readonly serverAdmin?: ServerAdmin

  /** Optional document query capability (MongoDB). */
  readonly documentQuery?: import('./document-types').DocumentQuery

  /** Optional document write capability (MongoDB). */
  readonly documentMutator?: import('./document-types').DocumentMutator

  /** Optional collection/index administration (MongoDB). */
  readonly documentAdmin?: import('./document-types').DocumentAdmin

  /** Optional server-monitoring capability (MongoDB). Separate from
   *  `serverStats` — the Postgres `ServerSnapshot` shape doesn't fit Mongo. */
  readonly mongoStats?: import('./mongo-stats-types').MongoStats
}

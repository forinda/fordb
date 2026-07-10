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
import type { ServerSnapshot, SessionRow, LockRow } from '../adapter/stats-types'
import type { RowEdit } from '../adapter/mutation-types'
import type { BrowseOptions } from '../adapter/browse-types'
import type { SchemaOps } from '../adapter/schema-types'
import type { ObjectKind, ObjectSummary } from '../adapter/object-types'
import type { RoleInfo, GrantInfo, SettingRow } from '../adapter/admin-types'
import type {
  DocsPage,
  DocumentMutator,
  FindOptions,
  OpenDocsResult
} from '../adapter/document-types'
import type { MongoSnapshot } from '../adapter/mongo-stats-types'

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

  serverStatsSupported(id: ConnectionId): Promise<boolean>
  getServerSnapshot(id: ConnectionId): Promise<ServerSnapshot>
  getSessions(id: ConnectionId): Promise<SessionRow[]>
  getLocks(id: ConnectionId): Promise<LockRow[]>

  mutationSupported(id: ConnectionId): Promise<boolean>
  applyEdits(id: ConnectionId, edits: RowEdit[]): Promise<void>

  browseSupported(id: ConnectionId): Promise<boolean>
  openBrowse(id: ConnectionId, opts: BrowseOptions): Promise<OpenQueryResult>

  schemaEditSupported(id: ConnectionId): Promise<boolean>
  schemaOps(id: ConnectionId): Promise<SchemaOps>
  applyDdl(id: ConnectionId, statements: string[]): Promise<void>

  /** Run a list of statements in one transaction (import a .sql file). */
  executeScript(id: ConnectionId, statements: string[]): Promise<void>

  objectsSupported(id: ConnectionId): Promise<boolean>
  objectKinds(id: ConnectionId): Promise<ObjectKind[]>
  listObjects(id: ConnectionId, schema: string, kind: ObjectKind): Promise<ObjectSummary[]>
  objectDefinition(
    id: ConnectionId,
    schema: string,
    kind: ObjectKind,
    name: string
  ): Promise<string>

  serverAdminSupported(id: ConnectionId): Promise<boolean>
  cancelBackend(id: ConnectionId, pid: number): Promise<boolean>
  terminateBackend(id: ConnectionId, pid: number): Promise<boolean>
  listRoles(id: ConnectionId): Promise<RoleInfo[]>
  roleGrants(id: ConnectionId, role: string): Promise<GrantInfo[]>
  serverSettings(id: ConnectionId): Promise<SettingRow[]>

  documentQuerySupported(id: ConnectionId): Promise<boolean>
  findDocs(
    id: ConnectionId,
    coll: string,
    filter: Record<string, unknown>,
    opts: FindOptions,
    pageSize: number
  ): Promise<OpenDocsResult>
  aggregateDocs(
    id: ConnectionId,
    coll: string,
    pipeline: Record<string, unknown>[],
    pageSize: number
  ): Promise<OpenDocsResult>
  fetchDocs(id: ConnectionId, queryId: string): Promise<DocsPage>
  closeDocs(id: ConnectionId, queryId: string): Promise<void>

  documentMutatorSupported(id: ConnectionId): Promise<boolean>
  insertDoc(
    id: ConnectionId,
    coll: string,
    doc: Record<string, unknown>
  ): ReturnType<DocumentMutator['insertOne']>
  updateDoc(
    id: ConnectionId,
    coll: string,
    docId: unknown,
    patch: Record<string, unknown>
  ): ReturnType<DocumentMutator['updateById']>
  deleteDoc(
    id: ConnectionId,
    coll: string,
    docId: unknown
  ): ReturnType<DocumentMutator['deleteById']>

  mongoStatsSupported(id: ConnectionId): Promise<boolean>
  mongoServerStatus(id: ConnectionId): Promise<MongoSnapshot>
}

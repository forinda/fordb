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
} from '@shared/adapter/types'
import type { ConnectionId, HostApi, TestResult } from '@shared/host/host-api'
import type {
  ServerSnapshot,
  SessionRow,
  LockRow,
  ServerStatsProvider
} from '@shared/adapter/stats-types'
import type { DataMutator, RowEdit } from '@shared/adapter/mutation-types'
import type { DataBrowser, BrowseOptions } from '@shared/adapter/browse-types'
import type { SchemaEditor, SchemaOps } from '@shared/adapter/schema-types'
import type { ObjectBrowser, ObjectKind, ObjectSummary } from '@shared/adapter/object-types'
import type { ServerAdmin, RoleInfo, GrantInfo, SettingRow } from '@shared/adapter/admin-types'
import type {
  DocumentAdmin,
  DocumentIndexSpec,
  DocumentMutator,
  DocumentQuery,
  DocsPage,
  FindOptions,
  OpenDocsResult
} from '@shared/adapter/document-types'
import type { MongoSnapshot, MongoStats } from '@shared/adapter/mongo-stats-types'
import { connectAdapter } from './connect-with-tunnel'
import type { ConnectionRegistry } from './connection-registry'
import type { DbAdapter } from '@shared/adapter/db-adapter'
import type { TunnelHandle } from './ssh-tunnel'
import { adapterForEngine } from './adapter-factory'

export class HostApiImpl implements HostApi {
  constructor(private readonly registry: ConnectionRegistry) {}

  async testConnection(profile: ConnectionProfile): Promise<TestResult> {
    // Resolve the adapter by engine (same factory the registry uses), routed
    // through the shared tunnel-aware connectAdapter helper (which opens the
    // SSH tunnel when profile.ssh is set, matching ConnectionRegistry.open).
    let adapter: DbAdapter | undefined
    let tunnel: TunnelHandle | undefined
    try {
      ;({ adapter, tunnel } = await connectAdapter((engine) => adapterForEngine(engine), profile))
      // Engine-agnostic liveness probe: every adapter implements listDatabases(),
      // unlike executeQuery() (SQL-only — MongoAdapter rejects it unconditionally).
      await adapter.listDatabases()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      // Always tear down both the adapter and the tunnel, regardless of
      // which step failed above.
      await adapter?.disconnect().catch(() => undefined)
      await tunnel?.close().catch(() => undefined)
    }
  }

  openConnection(profile: ConnectionProfile): Promise<ConnectionId> {
    return this.registry.open(profile)
  }

  closeConnection(id: ConnectionId): Promise<void> {
    return this.registry.close(id)
  }

  listDatabases(id: ConnectionId): Promise<string[]> {
    return this.registry.get(id).listDatabases()
  }
  listSchemas(id: ConnectionId): Promise<string[]> {
    return this.registry.get(id).listSchemas()
  }
  listTables(id: ConnectionId, schema: string): Promise<TableInfo[]> {
    return this.registry.get(id).listTables(schema)
  }
  getColumns(id: ConnectionId, schema: string, table: string): Promise<ColumnInfo[]> {
    return this.registry.get(id).getColumns(schema, table)
  }
  getKeys(id: ConnectionId, schema: string, table: string): Promise<KeyInfo[]> {
    return this.registry.get(id).getKeys(schema, table)
  }
  getIndexes(id: ConnectionId, schema: string, table: string): Promise<IndexInfo[]> {
    return this.registry.get(id).getIndexes(schema, table)
  }
  getChecks(id: ConnectionId, schema: string, table: string): Promise<CheckInfo[]> {
    return this.registry.get(id).getChecks?.(schema, table) ?? Promise.resolve([])
  }

  executeQuery(id: ConnectionId, sql: string): Promise<QueryResult> {
    return this.registry.get(id).executeQuery(sql)
  }
  executeReadOnly(id: ConnectionId, sql: string): Promise<QueryResult> {
    const a = this.registry.get(id)
    if (!a.executeReadOnly) throw new Error('read-only execution not supported for this engine')
    return a.executeReadOnly(sql)
  }
  openQuery(id: ConnectionId, sql: string, pageSize: number): Promise<OpenQueryResult> {
    return this.registry.get(id).openQuery(sql, pageSize)
  }
  fetchPage(id: ConnectionId, queryId: string): Promise<Page> {
    return this.registry.get(id).fetchPage(queryId)
  }
  closeQuery(id: ConnectionId, queryId: string): Promise<void> {
    return this.registry.get(id).closeQuery(queryId)
  }
  cancel(id: ConnectionId): Promise<void> {
    return this.registry.get(id).cancel()
  }

  private stats(id: ConnectionId): ServerStatsProvider {
    const s = this.registry.get(id).serverStats
    if (!s) throw new Error('Server stats are not supported by this engine')
    return s
  }

  async serverStatsSupported(id: ConnectionId): Promise<boolean> {
    return this.registry.get(id).serverStats != null
  }
  getServerSnapshot(id: ConnectionId): Promise<ServerSnapshot> {
    return this.stats(id).getServerSnapshot()
  }
  getSessions(id: ConnectionId): Promise<SessionRow[]> {
    return this.stats(id).getSessions()
  }
  getLocks(id: ConnectionId): Promise<LockRow[]> {
    return this.stats(id).getLocks()
  }

  private mutator(id: ConnectionId): DataMutator {
    const m = this.registry.get(id).dataMutator
    if (!m) throw new Error('Editing is not supported by this engine')
    return m
  }
  async mutationSupported(id: ConnectionId): Promise<boolean> {
    return this.registry.get(id).dataMutator != null
  }
  applyEdits(id: ConnectionId, edits: RowEdit[]): Promise<void> {
    return this.mutator(id).apply(edits)
  }

  private browser(id: ConnectionId): DataBrowser {
    const b = this.registry.get(id).dataBrowser
    if (!b) throw new Error('Browsing is not supported by this engine')
    return b
  }
  async browseSupported(id: ConnectionId): Promise<boolean> {
    return this.registry.get(id).dataBrowser != null
  }
  openBrowse(id: ConnectionId, opts: BrowseOptions): Promise<OpenQueryResult> {
    return this.browser(id).openBrowse(opts)
  }

  private schema(id: ConnectionId): SchemaEditor {
    const e = this.registry.get(id).schemaEditor
    if (!e) throw new Error('Structure editing is not supported by this engine')
    return e
  }
  async schemaEditSupported(id: ConnectionId): Promise<boolean> {
    return this.registry.get(id).schemaEditor != null
  }
  async schemaOps(id: ConnectionId): Promise<SchemaOps> {
    return this.schema(id).ops
  }
  applyDdl(id: ConnectionId, statements: string[]): Promise<void> {
    return this.schema(id).applyDdl(statements)
  }
  executeScript(id: ConnectionId, statements: string[]): Promise<void> {
    // applyDdl is the shared per-engine transactional statement runner — it does
    // not validate the statements are DDL, so it runs an INSERT/mixed script too.
    return this.schema(id).applyDdl(statements)
  }

  private objs(id: ConnectionId): ObjectBrowser {
    const o = this.registry.get(id).objects
    if (!o) throw new Error('Object browsing is not supported by this engine')
    return o
  }
  async objectsSupported(id: ConnectionId): Promise<boolean> {
    return this.registry.get(id).objects != null
  }
  async objectKinds(id: ConnectionId): Promise<ObjectKind[]> {
    return [...this.objs(id).kinds]
  }
  listObjects(id: ConnectionId, schema: string, kind: ObjectKind): Promise<ObjectSummary[]> {
    return this.objs(id).list(schema, kind)
  }
  objectDefinition(
    id: ConnectionId,
    schema: string,
    kind: ObjectKind,
    name: string
  ): Promise<string> {
    return this.objs(id).definition(schema, kind, name)
  }

  private admin(id: ConnectionId): ServerAdmin {
    const a = this.registry.get(id).serverAdmin
    if (!a) throw new Error('Server administration is not supported by this engine')
    return a
  }
  async serverAdminSupported(id: ConnectionId): Promise<boolean> {
    return this.registry.get(id).serverAdmin != null
  }
  cancelBackend(id: ConnectionId, pid: number): Promise<boolean> {
    return this.admin(id).cancelBackend(pid)
  }
  terminateBackend(id: ConnectionId, pid: number): Promise<boolean> {
    return this.admin(id).terminateBackend(pid)
  }
  listRoles(id: ConnectionId): Promise<RoleInfo[]> {
    return this.admin(id).listRoles()
  }
  roleGrants(id: ConnectionId, role: string): Promise<GrantInfo[]> {
    return this.admin(id).roleGrants(role)
  }
  serverSettings(id: ConnectionId): Promise<SettingRow[]> {
    return this.admin(id).serverSettings()
  }

  private docq(id: ConnectionId): DocumentQuery {
    const q = this.registry.get(id).documentQuery
    if (!q) throw new Error('Document queries are not supported by this engine')
    return q
  }
  async documentQuerySupported(id: ConnectionId): Promise<boolean> {
    return this.registry.get(id).documentQuery != null
  }
  findDocs(
    id: ConnectionId,
    db: string,
    coll: string,
    filter: Record<string, unknown>,
    opts: FindOptions,
    pageSize: number
  ): Promise<OpenDocsResult> {
    return this.docq(id).find(db, coll, filter, opts, pageSize)
  }
  aggregateDocs(
    id: ConnectionId,
    db: string,
    coll: string,
    pipeline: Record<string, unknown>[],
    pageSize: number
  ): Promise<OpenDocsResult> {
    return this.docq(id).aggregate(db, coll, pipeline, pageSize)
  }
  fetchDocs(id: ConnectionId, queryId: string): Promise<DocsPage> {
    return this.docq(id).fetchDocs(queryId)
  }
  closeDocs(id: ConnectionId, queryId: string): Promise<void> {
    return this.docq(id).closeDocs(queryId)
  }
  explainDoc(
    id: ConnectionId,
    db: string,
    coll: string,
    mode: 'find' | 'aggregate',
    query: Record<string, unknown> | Record<string, unknown>[]
  ): Promise<Record<string, unknown>> {
    return this.docq(id).explain(db, coll, mode, query)
  }

  private docmut(id: ConnectionId): DocumentMutator {
    const m = this.registry.get(id).documentMutator
    if (!m) throw new Error('Document writes are not supported by this engine')
    return m
  }
  async documentMutatorSupported(id: ConnectionId): Promise<boolean> {
    return this.registry.get(id).documentMutator != null
  }
  insertDoc(
    id: ConnectionId,
    db: string,
    coll: string,
    doc: Record<string, unknown>
  ): Promise<{ insertedId: unknown }> {
    return this.docmut(id).insertOne(db, coll, doc)
  }
  updateDoc(
    id: ConnectionId,
    db: string,
    coll: string,
    docId: unknown,
    patch: Record<string, unknown>
  ): Promise<{ matched: number }> {
    return this.docmut(id).updateById(db, coll, docId, patch)
  }
  deleteDoc(
    id: ConnectionId,
    db: string,
    coll: string,
    docId: unknown
  ): Promise<{ deleted: number }> {
    return this.docmut(id).deleteById(db, coll, docId)
  }
  countDocs(
    id: ConnectionId,
    db: string,
    coll: string,
    filter: Record<string, unknown>
  ): Promise<number> {
    return this.docmut(id).countMatching(db, coll, filter)
  }
  updateManyDocs(
    id: ConnectionId,
    db: string,
    coll: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ matched: number; modified: number }> {
    return this.docmut(id).updateMany(db, coll, filter, update)
  }
  deleteManyDocs(
    id: ConnectionId,
    db: string,
    coll: string,
    filter: Record<string, unknown>
  ): Promise<{ deleted: number }> {
    return this.docmut(id).deleteMany(db, coll, filter)
  }

  private docadmin(id: ConnectionId): DocumentAdmin {
    const a = this.registry.get(id).documentAdmin
    if (!a) throw new Error('Collection administration is not supported by this engine')
    return a
  }
  async documentAdminSupported(id: ConnectionId): Promise<boolean> {
    return this.registry.get(id).documentAdmin != null
  }
  createDocIndex(
    id: ConnectionId,
    db: string,
    coll: string,
    spec: DocumentIndexSpec
  ): Promise<void> {
    return this.docadmin(id).createIndex(db, coll, spec)
  }
  dropDocIndex(id: ConnectionId, db: string, coll: string, name: string): Promise<void> {
    return this.docadmin(id).dropIndex(db, coll, name)
  }
  createCollection(id: ConnectionId, db: string, coll: string): Promise<void> {
    return this.docadmin(id).createCollection(db, coll)
  }
  dropCollection(id: ConnectionId, db: string, coll: string): Promise<void> {
    return this.docadmin(id).dropCollection(db, coll)
  }
  renameCollection(id: ConnectionId, db: string, from: string, to: string): Promise<void> {
    return this.docadmin(id).renameCollection(db, from, to)
  }
  getValidator(
    id: ConnectionId,
    db: string,
    coll: string
  ): Promise<Record<string, unknown> | null> {
    return this.docadmin(id).getValidator(db, coll)
  }
  setValidator(
    id: ConnectionId,
    db: string,
    coll: string,
    validator: Record<string, unknown> | null
  ): Promise<void> {
    return this.docadmin(id).setValidator(db, coll, validator)
  }

  private mstats(id: ConnectionId): MongoStats {
    const s = this.registry.get(id).mongoStats
    if (!s) throw new Error('Server stats are not supported by this engine')
    return s
  }
  async mongoStatsSupported(id: ConnectionId): Promise<boolean> {
    return this.registry.get(id).mongoStats != null
  }
  mongoServerStatus(id: ConnectionId): Promise<MongoSnapshot> {
    return this.mstats(id).serverStatus()
  }
}

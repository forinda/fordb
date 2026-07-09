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
      await adapter.executeQuery('SELECT 1')
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

  executeQuery(id: ConnectionId, sql: string): Promise<QueryResult> {
    return this.registry.get(id).executeQuery(sql)
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
}

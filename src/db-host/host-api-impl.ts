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
import { connectAdapter } from './connect-with-tunnel'
import type { ConnectionRegistry } from './connection-registry'
import type { DbAdapter } from '@shared/adapter/db-adapter'
import type { TunnelHandle } from './ssh-tunnel'
import { PostgresAdapter } from './postgres/postgres-adapter'

export class HostApiImpl implements HostApi {
  constructor(private readonly registry: ConnectionRegistry) {}

  async testConnection(profile: ConnectionProfile): Promise<TestResult> {
    // HostApiImpl isn't handed the registry's private adapter factory, so it
    // uses the same `() => new PostgresAdapter()` the registry is normally
    // constructed with — this keeps testConnection's adapter creation
    // identical to the pre-fix behavior while routing through the shared
    // tunnel-aware connectAdapter helper (which now also opens the SSH
    // tunnel when profile.ssh is set, matching ConnectionRegistry.open).
    let adapter: DbAdapter | undefined
    let tunnel: TunnelHandle | undefined
    try {
      ;({ adapter, tunnel } = await connectAdapter(() => new PostgresAdapter(), profile))
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
}

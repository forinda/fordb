import type {
  ColumnInfo,
  ConnectionProfile,
  IndexInfo,
  KeyInfo,
  TableInfo
} from '../shared/adapter/types'
import type { ConnectionId, HostApi, TestResult } from '../shared/host/host-api'
import type { ConnectionRegistry } from './connection-registry'
import { PostgresAdapter } from './postgres/postgres-adapter'

export class HostApiImpl implements HostApi {
  constructor(private readonly registry: ConnectionRegistry) {}

  async testConnection(profile: ConnectionProfile): Promise<TestResult> {
    const adapter = new PostgresAdapter()
    try {
      await adapter.connect(profile)
      await adapter.executeQuery('SELECT 1')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      await adapter.disconnect().catch(() => undefined)
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
}

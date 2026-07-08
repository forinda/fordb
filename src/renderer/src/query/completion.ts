import type { SQLNamespace } from '@codemirror/lang-sql'
import { hostApi } from '../rpc'

const cache = new Map<string, SQLNamespace>()

/** Build a lang-sql schema { "schema.table": ["col", …] } for the connection. */
export async function loadSqlSchema(connectionId: string): Promise<SQLNamespace> {
  const cached = cache.get(connectionId)
  if (cached) return cached
  const api = await hostApi()
  const schemas = await api.listSchemas(connectionId)
  const ns: Record<string, string[]> = {}
  for (const schema of schemas) {
    const tables = await api.listTables(connectionId, schema)
    for (const t of tables) {
      const cols = await api.getColumns(connectionId, schema, t.name)
      ns[`${schema}.${t.name}`] = cols.map((c) => c.name)
    }
  }
  cache.set(connectionId, ns)
  return ns
}

export function invalidateSchema(connectionId: string): void {
  cache.delete(connectionId)
}

import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { CheckInfo, ColumnInfo, IndexInfo, KeyInfo, TableInfo } from '@shared/adapter/types'
import type { ObjectKind, ObjectSummary } from '@shared/adapter/object-types'
import { hostApi } from '../rpc'
import { qk } from './keys'

export function useSchemas(connId: string | null): UseQueryResult<string[]> {
  return useQuery({
    queryKey: connId ? qk.schemas(connId) : ['conn', 'none', 'schemas'],
    queryFn: async () => (await hostApi()).listSchemas(connId!),
    enabled: !!connId
  })
}

/** Role names for the owner dropdown; reuses the server-admin listRoles. */
export function useRoles(connId: string | null): UseQueryResult<string[]> {
  return useQuery({
    queryKey: connId ? qk.roles(connId) : ['conn', 'none', 'roles'],
    queryFn: async () => (await hostApi()).listRoles(connId!).then((rs) => rs.map((r) => r.name)),
    enabled: !!connId
  })
}

export function useTables(
  connId: string | null,
  schema: string | null
): UseQueryResult<TableInfo[]> {
  return useQuery({
    queryKey: connId && schema ? qk.tables(connId, schema) : ['conn', 'none', 'tables', ''],
    queryFn: async () => (await hostApi()).listTables(connId!, schema!),
    enabled: !!connId && !!schema
  })
}

export function useColumns(
  connId: string | null,
  schema: string | null,
  table: string | null
): UseQueryResult<ColumnInfo[]> {
  return useQuery({
    queryKey:
      connId && schema && table
        ? qk.columns(connId, schema, table)
        : ['conn', 'none', 'columns', '', ''],
    queryFn: async () => (await hostApi()).getColumns(connId!, schema!, table!),
    enabled: !!connId && !!schema && !!table
  })
}

export function useKeys(
  connId: string | null,
  schema: string | null,
  table: string | null
): UseQueryResult<KeyInfo[]> {
  return useQuery({
    queryKey:
      connId && schema && table ? qk.keys(connId, schema, table) : ['conn', 'none', 'keys', '', ''],
    queryFn: async () => (await hostApi()).getKeys(connId!, schema!, table!),
    enabled: !!connId && !!schema && !!table
  })
}

export function useIndexes(
  connId: string | null,
  schema: string | null,
  table: string | null
): UseQueryResult<IndexInfo[]> {
  return useQuery({
    queryKey:
      connId && schema && table
        ? qk.indexes(connId, schema, table)
        : ['conn', 'none', 'indexes', '', ''],
    queryFn: async () => (await hostApi()).getIndexes(connId!, schema!, table!),
    enabled: !!connId && !!schema && !!table
  })
}

export function useChecks(
  connId: string | null,
  schema: string | null,
  table: string | null
): UseQueryResult<CheckInfo[]> {
  return useQuery({
    queryKey:
      connId && schema && table
        ? qk.checks(connId, schema, table)
        : ['conn', 'none', 'checks', '', ''],
    queryFn: async () => (await hostApi()).getChecks(connId!, schema!, table!),
    enabled: !!connId && !!schema && !!table
  })
}

/** Non-hook column fetch sharing the same cache entry as useColumns. */
export function fetchColumns(
  qc: QueryClient,
  connId: string,
  schema: string,
  table: string
): Promise<ColumnInfo[]> {
  return qc.fetchQuery({
    queryKey: qk.columns(connId, schema, table),
    queryFn: async () => (await hostApi()).getColumns(connId, schema, table)
  })
}

export function fetchSchemas(qc: QueryClient, connId: string): Promise<string[]> {
  return qc.fetchQuery({
    queryKey: qk.schemas(connId),
    queryFn: async () => (await hostApi()).listSchemas(connId)
  })
}

export function fetchTables(qc: QueryClient, connId: string, schema: string): Promise<TableInfo[]> {
  return qc.fetchQuery({
    queryKey: qk.tables(connId, schema),
    queryFn: async () => (await hostApi()).listTables(connId, schema)
  })
}

/** Role names for the owner dropdown; reuses the server-admin listRoles. */
export function fetchRoles(qc: QueryClient, connId: string): Promise<string[]> {
  return qc.fetchQuery({
    queryKey: qk.roles(connId),
    queryFn: async () => (await hostApi()).listRoles(connId).then((rs) => rs.map((r) => r.name))
  })
}

export function fetchObjects(
  qc: QueryClient,
  connId: string,
  schema: string,
  kind: ObjectKind
): Promise<ObjectSummary[]> {
  return qc.fetchQuery({
    queryKey: qk.objects(connId, schema, kind),
    queryFn: async () => (await hostApi()).listObjects(connId, schema, kind)
  })
}

/** Invalidate all of a connection's introspection (schemas/tables/columns). */
export function invalidateIntrospection(qc: QueryClient, connId: string): Promise<void> {
  return qc.invalidateQueries({ queryKey: ['conn', connId] })
}

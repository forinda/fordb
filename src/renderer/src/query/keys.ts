export const qk = {
  profiles: (): readonly ['profiles'] => ['profiles'] as const,
  schemas: (connId: string): readonly ['conn', string, 'schemas'] =>
    ['conn', connId, 'schemas'] as const,
  tables: (connId: string, schema: string): readonly ['conn', string, 'tables', string] =>
    ['conn', connId, 'tables', schema] as const,
  columns: (
    connId: string,
    schema: string,
    table: string
  ): readonly ['conn', string, 'columns', string, string] =>
    ['conn', connId, 'columns', schema, table] as const,
  keys: (
    connId: string,
    schema: string,
    table: string
  ): readonly ['conn', string, 'keys', string, string] =>
    ['conn', connId, 'keys', schema, table] as const,
  indexes: (
    connId: string,
    schema: string,
    table: string
  ): readonly ['conn', string, 'indexes', string, string] =>
    ['conn', connId, 'indexes', schema, table] as const,
  objects: (
    connId: string,
    schema: string,
    kind: string
  ): readonly ['conn', string, 'objects', string, string] =>
    ['conn', connId, 'objects', schema, kind] as const,
  serverSnapshot: (connId: string): readonly ['conn', string, 'serverSnapshot'] =>
    ['conn', connId, 'serverSnapshot'] as const,
  sessions: (connId: string): readonly ['conn', string, 'sessions'] =>
    ['conn', connId, 'sessions'] as const,
  locks: (connId: string): readonly ['conn', string, 'locks'] => ['conn', connId, 'locks'] as const
}

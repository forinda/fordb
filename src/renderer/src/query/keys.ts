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
    ['conn', connId, 'columns', schema, table] as const
}

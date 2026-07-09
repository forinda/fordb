export function buildExplain(sql: string, dialect: 'pg' | 'sqlite', analyze: boolean): string {
  const body = sql.trim().replace(/;\s*$/, '')
  if (dialect === 'sqlite') return `EXPLAIN QUERY PLAN ${body}`
  return `EXPLAIN ${analyze ? 'ANALYZE ' : ''}${body}`
}

import { quoteIdent } from '../mutation/build-edits'

const qi = quoteIdent

/** Table-level privileges Postgres supports (plus ALL as a shorthand). */
export const TABLE_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER'
] as const

// ALL collapses the list; otherwise emit the (de-duplicated, upper-cased) set
// in a stable order so the preview is deterministic.
function privList(privileges: string[]): string {
  const up = privileges.map((p) => p.toUpperCase())
  if (up.includes('ALL')) return 'ALL'
  const order = TABLE_PRIVILEGES as readonly string[]
  const uniq = [...new Set(up)].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return uniq.join(', ')
}

/** GRANT <privs> ON <schema.table> TO <role> [WITH GRANT OPTION]. */
export function buildGrant(
  privileges: string[],
  schema: string,
  table: string,
  role: string,
  withGrantOption = false
): string {
  const head = `GRANT ${privList(privileges)} ON ${qi(schema)}.${qi(table)} TO ${qi(role)}`
  return withGrantOption ? `${head} WITH GRANT OPTION` : head
}

/** REVOKE <privs> ON <schema.table> FROM <role>. */
export function buildRevoke(
  privileges: string[],
  schema: string,
  table: string,
  role: string
): string {
  return `REVOKE ${privList(privileges)} ON ${qi(schema)}.${qi(table)} FROM ${qi(role)}`
}

import { quoteIdent } from '../mutation/build-edits'

/** Postgres role attributes, all emitted explicitly so ALTER is unambiguous. */
export interface RoleAttrs {
  login: boolean
  superuser: boolean
  createDb: boolean
  createRole: boolean
  replication: boolean
}

const qi = quoteIdent
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** The `WITH …` attribute clause shared by CREATE/ALTER ROLE. Password appended
 *  only when non-empty. */
function attrClause(a: RoleAttrs, password?: string): string {
  const parts = [
    a.login ? 'LOGIN' : 'NOLOGIN',
    a.superuser ? 'SUPERUSER' : 'NOSUPERUSER',
    a.createDb ? 'CREATEDB' : 'NOCREATEDB',
    a.createRole ? 'CREATEROLE' : 'NOCREATEROLE',
    a.replication ? 'REPLICATION' : 'NOREPLICATION'
  ]
  if (password) parts.push(`PASSWORD ${lit(password)}`)
  return parts.join(' ')
}

export function buildCreateRole(name: string, attrs: RoleAttrs, password?: string): string {
  return `CREATE ROLE ${qi(name)} WITH ${attrClause(attrs, password)}`
}

export function buildAlterRole(name: string, attrs: RoleAttrs, password?: string): string {
  return `ALTER ROLE ${qi(name)} WITH ${attrClause(attrs, password)}`
}

export function buildDropRole(name: string): string {
  return `DROP ROLE ${qi(name)}`
}

/** GRANT/REVOKE statements to move `role`'s membership from `before` to `after`
 *  (the parent roles it belongs to). Revokes first, then grants. */
export function membershipChanges(role: string, before: string[], after: string[]): string[] {
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  const revokes = before
    .filter((p) => !afterSet.has(p))
    .map((p) => `REVOKE ${qi(p)} FROM ${qi(role)}`)
  const grants = after.filter((p) => !beforeSet.has(p)).map((p) => `GRANT ${qi(p)} TO ${qi(role)}`)
  return [...revokes, ...grants]
}

/** Replace a `PASSWORD '…'` literal with `PASSWORD '****'` for display only —
 *  the real statement (with the actual password) is what executes. */
export function maskRolePassword(sql: string): string {
  return sql.replace(/PASSWORD '(?:[^']|'')*'/g, `PASSWORD '****'`)
}

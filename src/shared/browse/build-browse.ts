import type { BrowseOptions, Filter, Sort } from '../adapter/browse-types'
import { quoteIdent } from '../mutation/build-edits'

const COMPARE: Record<string, string> = {
  eq: '=',
  ne: '<>',
  lt: '<',
  gt: '>',
  le: '<=',
  ge: '>='
}

/** Build a parameterized SELECT for a browse. Values are BOUND ($n / ?); only
 *  quoted identifiers are interpolated. Pure — the engine runs it. */
export function buildBrowseSql(
  opts: BrowseOptions,
  dialect: 'pg' | 'sqlite'
): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  const ph = (v: unknown): string => {
    params.push(v)
    return dialect === 'pg' ? `$${params.length}` : '?'
  }
  // Escape LIKE metacharacters (\ % _) so a search for "10%" or "user_1" matches
  // those literals, not wildcards. ESCAPE '\' works on both PG and SQLite. The
  // value stays a bound parameter — this only fixes pattern semantics, not
  // injection (already prevented by binding).
  const esc = (v: unknown): string => String(v).replace(/[\\%_]/g, '\\$&')
  // ILIKE is Postgres-only; SQLite LIKE is already case-insensitive for ASCII.
  const likeKw = (ci: boolean): string => (ci && dialect === 'pg' ? 'ILIKE' : 'LIKE')
  const like = (col: string, pattern: string, not: boolean, ci: boolean): string =>
    `${col} ${not ? 'NOT ' : ''}${likeKw(ci)} ${ph(pattern)} ESCAPE '\\'`

  const where = opts.filters.map((f: Filter) => {
    const col = quoteIdent(f.column)
    switch (f.op) {
      case 'isNull':
        return `${col} IS NULL`
      case 'isNotNull':
        return `${col} IS NOT NULL`
      case 'contains':
        return like(col, `%${esc(f.value)}%`, false, false)
      case 'notContains':
        return like(col, `%${esc(f.value)}%`, true, false)
      case 'startsWith':
        return like(col, `${esc(f.value)}%`, false, false)
      case 'endsWith':
        return like(col, `%${esc(f.value)}`, false, false)
      case 'ilike':
        return like(col, `%${esc(f.value)}%`, false, true)
      case 'like':
        return `${col} LIKE ${ph(f.value)}` // raw pattern — user controls %
      case 'regex':
        return `${col} ~ ${ph(f.value)}`
      case 'notRegex':
        return `${col} !~ ${ph(f.value)}`
      case 'in': {
        const vals = String(f.value)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '')
        if (vals.length === 0) return `${col} IN (NULL)`
        return `${col} IN (${vals.map((v) => ph(v)).join(', ')})`
      }
      default:
        return `${col} ${COMPARE[f.op]} ${ph(f.value)}`
    }
  })
  const order = opts.sort.map(
    (s: Sort) => `${quoteIdent(s.column)} ${s.dir === 'desc' ? 'DESC' : 'ASC'}`
  )
  let sql = `SELECT * FROM ${quoteIdent(opts.schema)}.${quoteIdent(opts.table)}`
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`
  if (order.length) sql += ` ORDER BY ${order.join(', ')}`
  return { sql, params }
}

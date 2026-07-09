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
  const where = opts.filters.map((f: Filter) => {
    const col = quoteIdent(f.column)
    if (f.op === 'isNull') return `${col} IS NULL`
    if (f.op === 'isNotNull') return `${col} IS NOT NULL`
    if (f.op === 'contains') {
      // Escape LIKE metacharacters (\ % _) so a search for "10%" or "user_1"
      // matches those literals, not wildcard patterns. ESCAPE '\' works on both PG
      // and SQLite. The bound value is still a parameter — this only fixes the
      // pattern semantics, not injection (which is already prevented by binding).
      const escaped = String(f.value).replace(/[\\%_]/g, '\\$&')
      return `${col} LIKE ${ph(`%${escaped}%`)} ESCAPE '\\'`
    }
    return `${col} ${COMPARE[f.op]} ${ph(f.value)}`
  })
  const order = opts.sort.map(
    (s: Sort) => `${quoteIdent(s.column)} ${s.dir === 'desc' ? 'DESC' : 'ASC'}`
  )
  let sql = `SELECT * FROM ${quoteIdent(opts.schema)}.${quoteIdent(opts.table)}`
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`
  if (order.length) sql += ` ORDER BY ${order.join(', ')}`
  return { sql, params }
}

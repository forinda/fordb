import type { BrowseOptions, Filter, Sort } from '../adapter/browse-types'
import { quoteIdent } from '../mutation/build-edits'

const COMPARE: Record<string, string> = {
  eq: '=',
  ne: '<>',
  lt: '<',
  gt: '>',
  le: '<=',
  ge: '>=',
  contains: 'LIKE'
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
    const bound = f.op === 'contains' ? ph(`%${String(f.value)}%`) : ph(f.value)
    return `${col} ${COMPARE[f.op]} ${bound}`
  })
  const order = opts.sort.map(
    (s: Sort) => `${quoteIdent(s.column)} ${s.dir === 'desc' ? 'DESC' : 'ASC'}`
  )
  let sql = `SELECT * FROM ${quoteIdent(opts.schema)}.${quoteIdent(opts.table)}`
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`
  if (order.length) sql += ` ORDER BY ${order.join(', ')}`
  return { sql, params }
}

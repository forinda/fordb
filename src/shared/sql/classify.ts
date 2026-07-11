const ROW_RETURNING = /^(select|with|values|show|explain|table)\b/i

/** Strip leading line (--) and block comments and whitespace. */
function stripLeading(sql: string): string {
  let s = sql.trimStart()
  for (;;) {
    if (s.startsWith('--')) {
      const nl = s.indexOf('\n')
      s = nl === -1 ? '' : s.slice(nl + 1).trimStart()
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/')
      s = end === -1 ? '' : s.slice(end + 2).trimStart()
    } else {
      return s
    }
  }
}

export function isSelectLike(sql: string): boolean {
  return ROW_RETURNING.test(stripLeading(sql))
}

const READ_FIRST = /^(select|with|values|show|explain|table)\b/i
const CTE_WRITE = /\b(insert|update|delete|merge)\b/i

/** Conservative read-only gate for the MCP surface. Rejects anything not
 *  provably a single row-returning statement — a false accept is a security
 *  hole, so err toward rejection. */
export function isReadOnlyQuery(sql: string): boolean {
  const s = stripLeading(sql).trim()
  if (!s) return false
  // Single statement only: a ';' followed by any non-whitespace is a second
  // statement (a lone trailing ';' is fine).
  const semi = s.indexOf(';')
  if (semi !== -1 && s.slice(semi + 1).trim() !== '') return false
  const body = semi === -1 ? s : s.slice(0, semi)
  if (!READ_FIRST.test(body)) return false
  // EXPLAIN ANALYZE executes the plan — reject.
  if (/^explain\b/i.test(body) && /\banalyze\b/i.test(body)) return false
  // Data-modifying CTE (WITH x AS (DELETE ...) ...) writes — reject.
  if (/^with\b/i.test(body) && CTE_WRITE.test(body)) return false
  return true
}

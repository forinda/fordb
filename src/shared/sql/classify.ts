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

/** Conservative FIRST-LINE read-only filter for the MCP surface. Rejects
 *  anything not provably a single row-returning statement. This is NOT the sole
 *  boundary — a text classifier can't match the engine's parser (e.g. a SELECT
 *  invoking a volatile function that writes), so the MCP run_query MUST also
 *  execute in an engine-level read-only mode (Postgres READ ONLY transaction /
 *  SQLite query_only). This regex just rejects the obvious writes early. */
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

/** UX brake for the AI write path (NOT a security boundary — approval is). True
 *  for statements likely to lose data: DROP/TRUNCATE, ALTER ... DROP, and
 *  DELETE/UPDATE with no WHERE. Conservative: unclassifiable input → true. */
export function isDestructive(sql: string): boolean {
  const s = stripLeading(sql).trim()
  if (!s) return true
  if (/^(drop|truncate)\b/i.test(s)) return true
  if (/^alter\b/i.test(s) && /\bdrop\b/i.test(s)) return true
  if (/^(delete|update)\b/i.test(s) && !/\bwhere\b/i.test(s)) return true
  return false
}

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

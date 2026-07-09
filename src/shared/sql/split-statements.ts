/** Split a SQL script into statements on top-level `;` — ignoring semicolons
 *  inside single/double-quoted strings, line comments (-- …), and block
 *  comments (/* … *​/). Pragmatic (no PG dollar-quoting); adequate for fordb
 *  dumps and simple scripts. Empties trimmed out. */
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === "'" || c === '"') {
      cur += c
      i++
      while (i < sql.length) {
        // A doubled quote is an escaped quote inside the string.
        if (sql[i] === c && sql[i + 1] === c) {
          cur += c + c
          i += 2
          continue
        }
        cur += sql[i]
        if (sql[i] === c) {
          i++
          break
        }
        i++
      }
      continue
    }
    if (c === ';') {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      i++
      continue
    }
    cur += c
    i++
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

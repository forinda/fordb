type Dialect = 'pg' | 'sqlite'

const quote = (s: string): string => `'${s.replace(/'/g, "''")}'`
const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** Render a value as a valid, re-runnable SQL literal for a dump. Correctness
 *  (escaping so the dump parses), not injection defense — this is the user's own
 *  data being written to their own file. */
export function renderSqlLiteral(value: unknown, dialect: Dialect): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'number') {
    // NaN/Infinity aren't bare SQL literals. PG accepts the quoted+cast form;
    // SQLite has no such literal (it stores non-finite floats as NULL anyway).
    if (!Number.isFinite(value)) return dialect === 'pg' ? `'${String(value)}'::float8` : 'NULL'
    return String(value)
  }
  if (typeof value === 'boolean')
    return dialect === 'pg' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0'
  if (value instanceof Uint8Array)
    return dialect === 'pg' ? `'\\x${hex(value)}'::bytea` : `X'${hex(value)}'`
  if (Array.isArray(value)) {
    // Postgres array columns come back as JS arrays — render an ARRAY[...] literal
    // (elements recursively; empty → '{}' which coerces to the column type).
    if (dialect === 'pg')
      return value.length
        ? `ARRAY[${value.map((v) => renderSqlLiteral(v, dialect)).join(', ')}]`
        : `'{}'`
    return quote(JSON.stringify(value)) // SQLite has no array type
  }
  if (typeof value === 'string') return quote(value)
  if (value instanceof Date) return quote(value.toISOString())
  return quote(JSON.stringify(value)) // json/other objects
}

type Dialect = 'pg' | 'sqlite'

const quote = (s: string): string => `'${s.replace(/'/g, "''")}'`
const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** Render a value as a valid, re-runnable SQL literal for a dump. Correctness
 *  (escaping so the dump parses), not injection defense — this is the user's own
 *  data being written to their own file. */
export function renderSqlLiteral(value: unknown, dialect: Dialect): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean')
    return dialect === 'pg' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0'
  if (value instanceof Uint8Array)
    return dialect === 'pg' ? `'\\x${hex(value)}'::bytea` : `X'${hex(value)}'`
  if (typeof value === 'string') return quote(value)
  if (value instanceof Date) return quote(value.toISOString())
  return quote(JSON.stringify(value)) // json/array/other
}

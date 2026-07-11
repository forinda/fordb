export interface FromTable {
  table: string
  alias?: string
}

// Words that can follow a table reference but are NOT aliases.
const NOT_ALIAS = new Set([
  'on',
  'where',
  'join',
  'inner',
  'left',
  'right',
  'outer',
  'full',
  'cross',
  'group',
  'order',
  'having',
  'limit',
  'union',
  'using',
  'and',
  'or'
])

const FROM_RE = /\b(?:from|join)\s+([\w.]+)(?:\s+(?:as\s+)?(\w+))?/gi

/** Best-effort scan of FROM/JOIN table references (with optional [AS] alias).
 *  Not a real parser — good enough for completion, never throws. */
export function parseFromTables(sql: string): FromTable[] {
  const out: FromTable[] = []
  for (const m of sql.matchAll(FROM_RE)) {
    const ref = m[1]!
    const table = ref.includes('.') ? ref.slice(ref.lastIndexOf('.') + 1) : ref
    const maybeAlias = m[2]
    const alias = maybeAlias && !NOT_ALIAS.has(maybeAlias.toLowerCase()) ? maybeAlias : undefined
    out.push(alias ? { table, alias } : { table })
  }
  return out
}

/** Resolve a prefix (alias or bare table name) to a table name, using the
 *  parsed FROM tables; falls back to the prefix itself. */
export function resolveTable(prefix: string, from: FromTable[]): string {
  const hit = from.find((f) => f.alias === prefix || f.table === prefix)
  return hit ? hit.table : prefix
}

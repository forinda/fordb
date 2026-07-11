import type { ColumnSpec, DdlChange, InlineForeignKey, TableSpec } from '../adapter/schema-types'

export type Dialect = 'pg' | 'sqlite'

export interface ColRow {
  name: string
  type: string
  nullable: boolean
  pk: boolean
  unique: boolean
  default: string
}
export interface FkRow {
  name: string
  refSchema: string
  refTable: string
  pairs: { local: string; ref: string }[]
}
export interface IdxRow {
  name: string
  columns: string[]
  unique: boolean
}

export const emptyCol = (): ColRow => ({
  name: '',
  type: '',
  nullable: true,
  pk: false,
  unique: false,
  default: ''
})

/** Column names (trimmed, non-empty) that appear more than once. */
export function duplicateColumnNames(cols: ColRow[]): string[] {
  const seen = new Set<string>()
  const dups = new Set<string>()
  for (const c of cols) {
    const n = c.name.trim()
    if (!n) continue
    if (seen.has(n)) dups.add(n)
    seen.add(n)
  }
  return [...dups]
}

/** Pure assembly of the CREATE TABLE spec from the dialog rows. */
export function buildTableSpec(
  cols: ColRow[],
  fks: FkRow[],
  table: string,
  schema: string,
  dialect: Dialect
): TableSpec {
  const columns: ColumnSpec[] = cols
    .filter((c) => c.name.trim() && c.type.trim())
    .map((c) => ({
      name: c.name.trim(),
      type: c.type.trim(),
      notNull: !c.nullable,
      default: c.default.trim() ? c.default.trim() : undefined,
      unique: c.unique || undefined
    }))
  const primaryKey = cols.filter((c) => c.pk && c.name.trim()).map((c) => c.name.trim())
  const foreignKeys: InlineForeignKey[] = fks
    .map((f) => ({ f, pairs: f.pairs.filter((p) => p.local.trim() && p.ref.trim()) }))
    .filter(({ f, pairs }) => pairs.length > 0 && f.refTable)
    .map(({ f, pairs }) => {
      const cols = pairs.map((p) => p.local.trim())
      return {
        name: f.name.trim() || `fk_${table.trim()}_${cols[0]}`,
        columns: cols,
        refSchema: dialect === 'sqlite' ? undefined : f.refSchema || undefined,
        refTable: f.refTable,
        refColumns: pairs.map((p) => p.ref.trim())
      }
    })
  return {
    schema,
    table: table.trim(),
    columns,
    primaryKey: primaryKey.length ? primaryKey : undefined,
    foreignKeys: foreignKeys.length ? foreignKeys : undefined
  }
}

/** Map dialog index rows to createIndex DdlChanges (drops empty-column rows). */
export function buildIndexChanges(indexes: IdxRow[], schema: string, table: string): DdlChange[] {
  return indexes
    .map((ix) => ({ ix, columns: ix.columns.filter((c) => c.trim()) }))
    .filter(({ columns }) => columns.length > 0)
    .map(({ ix, columns }) => ({
      kind: 'createIndex' as const,
      spec: {
        schema,
        table,
        name: ix.name.trim() || `idx_${table}_${columns[0]}`,
        columns,
        unique: ix.unique || undefined
      }
    }))
}

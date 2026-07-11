import type { ColumnSpec, InlineForeignKey, TableSpec } from '../adapter/schema-types'

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
  columns: string[]
  refSchema: string
  refTable: string
  refColumns: string[]
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
    .filter((f) => f.columns.length && f.refTable && f.refColumns.length)
    .map((f) => ({
      name: f.name.trim() || `fk_${table.trim()}_${f.columns[0]}`,
      columns: f.columns,
      refSchema: dialect === 'sqlite' ? undefined : f.refSchema || undefined,
      refTable: f.refTable,
      refColumns: f.refColumns
    }))
  return {
    schema,
    table: table.trim(),
    columns,
    primaryKey: primaryKey.length ? primaryKey : undefined,
    foreignKeys: foreignKeys.length ? foreignKeys : undefined
  }
}

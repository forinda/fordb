import type { Filter } from '../adapter/browse-types'

/** A foreign key as the browse grid needs it for click-through navigation:
 *  local columns → referenced table + columns (single or composite). */
export interface FkNav {
  columns: string[]
  refSchema?: string
  refTable: string
  refColumns: string[]
}

/** The FK whose local columns include `column`, if any. */
export function fkForColumn(fks: FkNav[], column: string): FkNav | undefined {
  return fks.find((fk) => fk.columns.includes(column))
}

/** Build eq-filters on the referenced columns from the local FK column values.
 *  `values` is aligned to `fk.columns` order; the result targets `fk.refColumns`. */
export function fkFilters(fk: FkNav, values: unknown[]): Filter[] {
  return fk.refColumns.map((col, i) => ({ column: col, op: 'eq', value: values[i] }))
}

// Pure helpers for bulk data-grid edits (bulk edit + clone rows).

export type CellVal = string | null

/** Apply a single column edit to a set of target rows, returning a new edit map
 *  keyed `${row}:${column}`. Used for bulk edit — one value fanned out across
 *  every selected row. Existing edits are preserved; the same cell is overwritten. */
export function fanoutEdit(
  existing: Record<string, CellVal>,
  targetRows: number[],
  column: string,
  value: CellVal
): Record<string, CellVal> {
  const next = { ...existing }
  for (const row of targetRows) next[`${row}:${column}`] = value
  return next
}

/** Clone source rows into insert-row objects, dropping the primary-key columns
 *  (auto-increment / assigned keys); the cloned rows are added as editable
 *  inserts, so a natural key can be filled in before applying. */
export function cloneRows(
  rows: Record<string, CellVal>[],
  pkColumns: string[]
): Record<string, CellVal>[] {
  const pk = new Set(pkColumns)
  return rows.map((row) => {
    const out: Record<string, CellVal> = {}
    for (const [col, val] of Object.entries(row)) if (!pk.has(col)) out[col] = val
    return out
  })
}

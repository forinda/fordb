import type { Cell, RowEdit } from '../adapter/mutation-types'

/** Quote a SQL identifier, doubling embedded double-quotes. */
export function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`
}

/** Render a value as a SQL literal FOR DISPLAY ONLY (never executed). */
export function renderLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return `'${String(v).replace(/'/g, "''")}'`
}

const qualified = (schema: string, table: string): string =>
  `${quoteIdent(schema)}.${quoteIdent(table)}`
const eq = (c: Cell): string => `${quoteIdent(c.column)} = ${renderLiteral(c.value)}`

/** Display SQL for one edit (bound values shown as literals). */
export function previewEdit(e: RowEdit): string {
  const t = qualified(e.schema, e.table)
  if (e.kind === 'update')
    return `UPDATE ${t} SET ${e.set.map(eq).join(', ')} WHERE ${e.pk.map(eq).join(' AND ')}`
  if (e.kind === 'insert')
    return `INSERT INTO ${t} (${e.values.map((c) => quoteIdent(c.column)).join(', ')}) VALUES (${e.values
      .map((c) => renderLiteral(c.value))
      .join(', ')})`
  return `DELETE FROM ${t} WHERE ${e.pk.map(eq).join(' AND ')}`
}

export function previewEdits(edits: RowEdit[]): string[] {
  return edits.map(previewEdit)
}

export interface PendingEdits {
  schema: string
  table: string
  updates: { pk: Cell[]; set: Cell[] }[]
  inserts: { values: Cell[] }[]
  deletes: { pk: Cell[] }[]
}

/** Flatten the grid's pending change set into an ordered RowEdit list. */
export function buildEdits(p: PendingEdits): RowEdit[] {
  const { schema, table } = p
  return [
    ...p.updates.map((u): RowEdit => ({ kind: 'update', schema, table, pk: u.pk, set: u.set })),
    ...p.inserts.map((i): RowEdit => ({ kind: 'insert', schema, table, values: i.values })),
    ...p.deletes.map((d): RowEdit => ({ kind: 'delete', schema, table, pk: d.pk }))
  ]
}

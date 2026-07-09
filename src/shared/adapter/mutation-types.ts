/** A column/value pair. `value` is string | number | boolean | null. */
export interface Cell {
  column: string
  value: unknown
}

export type RowEdit =
  | { kind: 'update'; schema: string; table: string; pk: Cell[]; set: Cell[] }
  | { kind: 'insert'; schema: string; table: string; values: Cell[] }
  | { kind: 'delete'; schema: string; table: string; pk: Cell[] }

/** Optional write capability. Engines that can't mutate omit it. `apply` runs
 *  all edits in ONE transaction with BOUND values, rolling back on any error.
 *  Preview SQL is generated purely on the renderer (see @shared/mutation/build-edits). */
export interface DataMutator {
  apply(edits: RowEdit[]): Promise<void>
}

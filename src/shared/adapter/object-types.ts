export type ObjectKind = 'view' | 'function' | 'trigger' | 'sequence' | 'materializedView'
export interface ObjectSummary {
  name: string
}
export interface ObjectBrowser {
  /** Which object kinds this engine exposes (drives the tree categories). */
  readonly kinds: readonly ObjectKind[]
  list(schema: string, kind: ObjectKind): Promise<ObjectSummary[]>
  /** Reconstructed DDL / stored definition for one object. */
  definition(schema: string, kind: ObjectKind, name: string): Promise<string>
}

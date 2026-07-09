export interface SchemaOps {
  createTable: boolean
  addColumn: boolean
  createIndex: boolean
  dropIndex: boolean
  addForeignKey: boolean
  dropForeignKey: boolean
  dropTable: boolean
  createSchema: boolean
  dropSchema: boolean
  createDatabase: boolean
  dropDatabase: boolean
}

export interface ColumnSpec {
  name: string
  type: string // raw engine type text
  notNull?: boolean
  default?: string | null // raw SQL expression; null/absent = none
}
export interface TableSpec {
  schema: string
  table: string
  columns: ColumnSpec[]
  primaryKey?: string[]
}
export interface IndexSpec {
  schema: string
  table: string
  name: string
  columns: string[]
  unique?: boolean
}
export interface ForeignKeySpec {
  schema: string
  table: string
  name: string
  columns: string[]
  refSchema: string
  refTable: string
  refColumns: string[]
}

export type DdlChange =
  | { kind: 'createTable'; spec: TableSpec }
  | { kind: 'addColumn'; schema: string; table: string; column: ColumnSpec }
  | { kind: 'createIndex'; spec: IndexSpec }
  | { kind: 'dropIndex'; schema: string; name: string }
  | { kind: 'addForeignKey'; spec: ForeignKeySpec }
  | { kind: 'dropForeignKey'; schema: string; table: string; name: string }
  | { kind: 'dropTable'; schema: string; table: string }
  | { kind: 'createSchema'; name: string }
  | { kind: 'dropSchema'; name: string }
  | { kind: 'createDatabase'; name: string }
  | { kind: 'dropDatabase'; name: string }

/** Optional structure-editing capability: advertises supported ops and applies
 *  pre-generated, user-previewed DDL statements transactionally. */
export interface SchemaEditor {
  readonly ops: SchemaOps
  applyDdl(statements: string[]): Promise<void>
}

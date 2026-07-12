import type { OpenQueryResult } from './types'

export type FilterOp =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'gt'
  | 'le'
  | 'ge'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'like' // raw LIKE pattern (user supplies %)
  | 'ilike' // case-insensitive (Postgres ILIKE; falls back to LIKE on SQLite)
  | 'in' // comma-separated list → IN (...)
  | 'regex' // Postgres ~
  | 'notRegex' // Postgres !~
  | 'isNull'
  | 'isNotNull'

export interface Filter {
  column: string
  op: FilterOp
  value?: unknown // absent for isNull/isNotNull
}
export interface Sort {
  column: string
  dir: 'asc' | 'desc'
}
export interface BrowseOptions {
  schema: string
  table: string
  filters: Filter[] // AND-joined
  sort: Sort[] // in order; empty → no ORDER BY (caller supplies the pk default)
  pageSize: number
}

/** Optional structured-browse capability: builds a parameterized SELECT and
 *  opens a cursor (paged via the existing fetchPage/closeQuery). */
export interface DataBrowser {
  openBrowse(opts: BrowseOptions): Promise<OpenQueryResult>
}

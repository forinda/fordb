export interface FindOptions {
  projection?: Record<string, unknown>
  sort?: Record<string, 1 | -1>
  limit?: number
  skip?: number
}
export interface OpenDocsResult {
  queryId: string
}
export interface DocsPage {
  docs: Record<string, unknown>[]
  done: boolean
}
export interface DocumentQuery {
  find(
    db: string,
    coll: string,
    filter: Record<string, unknown>,
    opts: FindOptions,
    pageSize: number
  ): Promise<OpenDocsResult>
  aggregate(
    db: string,
    coll: string,
    pipeline: Record<string, unknown>[],
    pageSize: number
  ): Promise<OpenDocsResult>
  fetchDocs(queryId: string): Promise<DocsPage>
  closeDocs(queryId: string): Promise<void>
  /** Query plan (executionStats) for a find filter or an aggregate pipeline. */
  explain(
    db: string,
    coll: string,
    mode: 'find' | 'aggregate',
    query: Record<string, unknown> | Record<string, unknown>[]
  ): Promise<Record<string, unknown>>
}

export interface DocumentIndexSpec {
  /** Field → direction (1 asc, -1 desc). Order matters for compound indexes. */
  keys: Record<string, 1 | -1>
  name?: string
  unique?: boolean
}

/** Optional collection/index administration (MongoDB). */
export interface DocumentAdmin {
  createIndex(db: string, coll: string, spec: DocumentIndexSpec): Promise<void>
  dropIndex(db: string, coll: string, name: string): Promise<void>
  createCollection(db: string, coll: string): Promise<void>
  dropCollection(db: string, coll: string): Promise<void>
  renameCollection(db: string, from: string, to: string): Promise<void>
  /** The collection's schema-validation rule (e.g. {$jsonSchema}), or null. */
  getValidator(db: string, coll: string): Promise<Record<string, unknown> | null>
  /** Set (non-null) or clear (null) the collection's validator via collMod. */
  setValidator(db: string, coll: string, validator: Record<string, unknown> | null): Promise<void>
}

export interface DocumentMutator {
  insertOne(
    db: string,
    coll: string,
    doc: Record<string, unknown>
  ): Promise<{ insertedId: unknown }>
  updateById(
    db: string,
    coll: string,
    id: unknown,
    patch: Record<string, unknown>
  ): Promise<{ matched: number }>
  deleteById(db: string, coll: string, id: unknown): Promise<{ deleted: number }>
  /** Count documents matching a filter — the bulk preview uses this. */
  countMatching(db: string, coll: string, filter: Record<string, unknown>): Promise<number>
  /** Update every document matching `filter` with a Mongo update (e.g. {$set}). */
  updateMany(
    db: string,
    coll: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ matched: number; modified: number }>
  /** Delete every document matching `filter`. */
  deleteMany(
    db: string,
    coll: string,
    filter: Record<string, unknown>
  ): Promise<{ deleted: number }>
}

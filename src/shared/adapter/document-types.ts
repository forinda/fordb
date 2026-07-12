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
}

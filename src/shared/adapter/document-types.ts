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

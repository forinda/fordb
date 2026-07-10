import type { Db, FindCursor, AggregationCursor } from 'mongodb'
import type {
  DocsPage,
  DocumentQuery,
  FindOptions,
  OpenDocsResult
} from '@shared/adapter/document-types'
import { toJsonSafe, reviveEjson } from './ejson'

interface OpenCursor {
  cursor: FindCursor | AggregationCursor
  pageSize: number
}

/** Cursor-backed find/aggregate paging over a MongoDB database. closeAll()
 *  closes every open cursor and clears the map, so the adapter's cancel()
 *  (and disconnect()) can drop all in-flight cursors without leaving stale
 *  queryId entries behind. */
export class MongoDocumentQuery implements DocumentQuery {
  private cursors = new Map<string, OpenCursor>()
  private next = 1
  // Resolve a Db by name so each query targets the collection's own
  // database (the tree lists all databases; the connection default isn't it).
  constructor(private readonly dbFor: (name: string) => Db) {}

  async closeAll(): Promise<void> {
    const open = [...this.cursors.values()]
    this.cursors.clear()
    await Promise.all(open.map((o) => o.cursor.close().catch(() => {})))
  }

  private open(cursor: FindCursor | AggregationCursor, pageSize: number): OpenDocsResult {
    const queryId = `d${this.next++}`
    this.cursors.set(queryId, { cursor, pageSize })
    return { queryId }
  }

  find(
    db: string,
    coll: string,
    filter: Record<string, unknown>,
    opts: FindOptions,
    pageSize: number
  ): Promise<OpenDocsResult> {
    const c = this.dbFor(db)
      .collection(coll)
      .find(reviveEjson(filter) as Record<string, unknown>, {
        projection: opts.projection,
        sort: opts.sort as never,
        limit: opts.limit,
        skip: opts.skip
      })
    return Promise.resolve(this.open(c, pageSize))
  }

  aggregate(
    db: string,
    coll: string,
    pipeline: Record<string, unknown>[],
    pageSize: number
  ): Promise<OpenDocsResult> {
    const c = this.dbFor(db)
      .collection(coll)
      .aggregate(reviveEjson(pipeline) as Record<string, unknown>[])
    return Promise.resolve(this.open(c, pageSize))
  }

  async fetchDocs(queryId: string): Promise<DocsPage> {
    const open = this.cursors.get(queryId)
    if (!open) throw new Error(`Unknown queryId: ${queryId}`)
    const docs: Record<string, unknown>[] = []
    for (let i = 0; i < open.pageSize; i++) {
      const doc = await open.cursor.next()
      if (doc == null) break
      docs.push(toJsonSafe(doc) as Record<string, unknown>)
    }
    const done = docs.length < open.pageSize
    if (done) await this.closeDocs(queryId)
    return { docs, done }
  }

  async closeDocs(queryId: string): Promise<void> {
    const open = this.cursors.get(queryId)
    if (!open) return
    this.cursors.delete(queryId)
    await open.cursor.close()
  }
}

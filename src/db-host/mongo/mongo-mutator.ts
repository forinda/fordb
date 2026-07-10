import { ObjectId, type Db } from 'mongodb'
import type { DocumentMutator } from '@shared/adapter/document-types'

/** Coerce a JSON-safe id back to a BSON match value: {$oid} → ObjectId, else
 *  the value as-is (numbers/strings match directly). */
function toId(id: unknown): unknown {
  if (id && typeof id === 'object' && '$oid' in id)
    return new ObjectId((id as { $oid: string }).$oid)
  return id
}

export class MongoDocumentMutator implements DocumentMutator {
  constructor(private readonly db: () => Db) {}
  async insertOne(coll: string, doc: Record<string, unknown>): Promise<{ insertedId: unknown }> {
    const r = await this.db().collection(coll).insertOne(doc)
    return { insertedId: r.insertedId }
  }
  async updateById(
    coll: string,
    id: unknown,
    patch: Record<string, unknown>
  ): Promise<{ matched: number }> {
    const r = await this.db()
      .collection(coll)
      .updateOne({ _id: toId(id) as never }, { $set: patch })
    return { matched: r.matchedCount }
  }
  async deleteById(coll: string, id: unknown): Promise<{ deleted: number }> {
    const r = await this.db()
      .collection(coll)
      .deleteOne({ _id: toId(id) as never })
    return { deleted: r.deletedCount }
  }
}

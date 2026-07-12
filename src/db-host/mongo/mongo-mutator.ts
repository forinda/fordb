import { ObjectId, type Db } from 'mongodb'
import type { DocumentMutator } from '@shared/adapter/document-types'
import { toJsonSafe, reviveEjson } from './ejson'

/** Coerce a JSON-safe id back to a BSON match value: {$oid} → ObjectId,
 *  {$date} → Date, else the value as-is (numbers/strings match directly). */
function toId(id: unknown): unknown {
  if (id && typeof id === 'object' && '$oid' in id)
    return new ObjectId((id as { $oid: string }).$oid)
  if (id && typeof id === 'object' && '$date' in id)
    return new Date((id as { $date: string }).$date)
  return id
}

export class MongoDocumentMutator implements DocumentMutator {
  constructor(private readonly dbFor: (name: string) => Db) {}
  async insertOne(
    db: string,
    coll: string,
    doc: Record<string, unknown>
  ): Promise<{ insertedId: unknown }> {
    const r = await this.dbFor(db)
      .collection(coll)
      .insertOne(reviveEjson(doc) as Record<string, unknown>)
    // insertedId is a raw BSON value (e.g. ObjectId) when auto-generated; it
    // must be JSON-safe before crossing the RPC boundary (structuredClone
    // drops ObjectId's prototype), or a later update/delete by this id will
    // match 0 docs.
    return { insertedId: toJsonSafe(r.insertedId) }
  }
  async updateById(
    db: string,
    coll: string,
    id: unknown,
    patch: Record<string, unknown>
  ): Promise<{ matched: number }> {
    // Defense-in-depth: never let a caller $set _id, even though diffSet
    // upstream already excludes it.
    const { _id: _drop, ...safe } = patch
    void _drop
    const r = await this.dbFor(db)
      .collection(coll)
      .updateOne({ _id: toId(id) as never }, { $set: reviveEjson(safe) as Record<string, unknown> })
    return { matched: r.matchedCount }
  }
  async deleteById(db: string, coll: string, id: unknown): Promise<{ deleted: number }> {
    const r = await this.dbFor(db)
      .collection(coll)
      .deleteOne({ _id: toId(id) as never })
    return { deleted: r.deletedCount }
  }
  async countMatching(db: string, coll: string, filter: Record<string, unknown>): Promise<number> {
    return this.dbFor(db)
      .collection(coll)
      .countDocuments(reviveEjson(filter) as Record<string, unknown>)
  }
  async updateMany(
    db: string,
    coll: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ matched: number; modified: number }> {
    const r = await this.dbFor(db)
      .collection(coll)
      .updateMany(
        reviveEjson(filter) as Record<string, unknown>,
        reviveEjson(update) as Record<string, unknown>
      )
    return { matched: r.matchedCount, modified: r.modifiedCount }
  }
  async deleteMany(
    db: string,
    coll: string,
    filter: Record<string, unknown>
  ): Promise<{ deleted: number }> {
    const r = await this.dbFor(db)
      .collection(coll)
      .deleteMany(reviveEjson(filter) as Record<string, unknown>)
    return { deleted: r.deletedCount }
  }
}

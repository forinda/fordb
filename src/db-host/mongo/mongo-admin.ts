import type { Db } from 'mongodb'
import type { DocumentAdmin, DocumentIndexSpec } from '@shared/adapter/document-types'

/** MongoDB collection/index administration. Backed by the driver's
 *  createIndex/dropIndex — no raw command surface reaches the renderer. */
export class MongoDocumentAdmin implements DocumentAdmin {
  constructor(private readonly dbFor: (name: string) => Db) {}

  async createIndex(db: string, coll: string, spec: DocumentIndexSpec): Promise<void> {
    await this.dbFor(db)
      .collection(coll)
      .createIndex(spec.keys, { name: spec.name, unique: spec.unique })
  }

  async dropIndex(db: string, coll: string, name: string): Promise<void> {
    await this.dbFor(db).collection(coll).dropIndex(name)
  }

  async createCollection(db: string, coll: string): Promise<void> {
    await this.dbFor(db).createCollection(coll)
  }

  async dropCollection(db: string, coll: string): Promise<void> {
    await this.dbFor(db).collection(coll).drop()
  }

  async renameCollection(db: string, from: string, to: string): Promise<void> {
    await this.dbFor(db).renameCollection(from, to)
  }
}

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

  async getValidator(db: string, coll: string): Promise<Record<string, unknown> | null> {
    // The driver's default listCollections type narrows away `options`, so read
    // the full CollectionInfo through a cast.
    const [info] = (await this.dbFor(db).listCollections({ name: coll }).toArray()) as {
      options?: { validator?: Record<string, unknown> }
    }[]
    const validator = info?.options?.validator
    return validator && Object.keys(validator).length ? validator : null
  }

  async setValidator(
    db: string,
    coll: string,
    validator: Record<string, unknown> | null
  ): Promise<void> {
    // collMod with an empty validator + validationLevel 'off' removes the rule.
    await this.dbFor(db).command({
      collMod: coll,
      validator: validator ?? {},
      validationLevel: validator ? 'strict' : 'off'
    })
  }
}

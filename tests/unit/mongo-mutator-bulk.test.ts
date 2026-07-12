import { describe, it, expect } from 'vitest'
import type { Db } from 'mongodb'
import { MongoDocumentMutator } from '../../src/db-host/mongo/mongo-mutator'

function fakeDb(): { db: Db; calls: unknown[][] } {
  const calls: unknown[][] = []
  const collection = (): unknown => ({
    countDocuments: (filter: unknown) => {
      calls.push(['countDocuments', filter])
      return Promise.resolve(3)
    },
    updateMany: (filter: unknown, update: unknown) => {
      calls.push(['updateMany', filter, update])
      return Promise.resolve({ matchedCount: 3, modifiedCount: 2 })
    },
    deleteMany: (filter: unknown) => {
      calls.push(['deleteMany', filter])
      return Promise.resolve({ deletedCount: 3 })
    }
  })
  return { db: { collection } as unknown as Db, calls }
}

describe('MongoDocumentMutator bulk ops', () => {
  it('countMatching passes the (revived) filter and returns the count', async () => {
    const { db, calls } = fakeDb()
    const m = new MongoDocumentMutator(() => db)
    expect(await m.countMatching('shop', 'orders', { status: 'stale' })).toBe(3)
    expect(calls).toEqual([['countDocuments', { status: 'stale' }]])
  })

  it('updateMany passes filter + update and returns matched/modified', async () => {
    const { db, calls } = fakeDb()
    const m = new MongoDocumentMutator(() => db)
    const r = await m.updateMany(
      'shop',
      'orders',
      { status: 'stale' },
      { $set: { archived: true } }
    )
    expect(r).toEqual({ matched: 3, modified: 2 })
    expect(calls).toEqual([['updateMany', { status: 'stale' }, { $set: { archived: true } }]])
  })

  it('deleteMany passes the filter and returns the deleted count', async () => {
    const { db, calls } = fakeDb()
    const m = new MongoDocumentMutator(() => db)
    expect(await m.deleteMany('shop', 'orders', { status: 'stale' })).toEqual({ deleted: 3 })
    expect(calls).toEqual([['deleteMany', { status: 'stale' }]])
  })
})

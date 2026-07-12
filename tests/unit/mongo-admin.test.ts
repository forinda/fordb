import { describe, it, expect } from 'vitest'
import type { Db } from 'mongodb'
import { MongoDocumentAdmin } from '../../src/db-host/mongo/mongo-admin'

// A minimal fake Db → collection recording the driver calls the admin makes.
function fakeDb(): { db: Db; calls: unknown[][] } {
  const calls: unknown[][] = []
  const collection = (): unknown => ({
    createIndex: (keys: unknown, opts: unknown) => {
      calls.push(['createIndex', keys, opts])
      return Promise.resolve('idx')
    },
    dropIndex: (name: unknown) => {
      calls.push(['dropIndex', name])
      return Promise.resolve()
    }
  })
  return { db: { collection } as unknown as Db, calls }
}

describe('MongoDocumentAdmin', () => {
  it('createIndex passes keys and name/unique options to the driver', async () => {
    const { db, calls } = fakeDb()
    const admin = new MongoDocumentAdmin(() => db)
    await admin.createIndex('shop', 'orders', {
      keys: { customer: 1, created: -1 },
      name: 'by_customer',
      unique: true
    })
    expect(calls).toEqual([
      ['createIndex', { customer: 1, created: -1 }, { name: 'by_customer', unique: true }]
    ])
  })

  it('dropIndex passes the index name to the driver', async () => {
    const { db, calls } = fakeDb()
    const admin = new MongoDocumentAdmin(() => db)
    await admin.dropIndex('shop', 'orders', 'by_customer')
    expect(calls).toEqual([['dropIndex', 'by_customer']])
  })
})

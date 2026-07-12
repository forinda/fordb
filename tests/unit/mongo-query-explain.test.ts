import { describe, it, expect } from 'vitest'
import type { Db } from 'mongodb'
import { MongoDocumentQuery } from '../../src/db-host/mongo/mongo-query'

function fakeDb(): { db: Db; calls: unknown[][] } {
  const calls: unknown[][] = []
  const collection = (): unknown => ({
    find: (filter: unknown) => {
      calls.push(['find', filter])
      return { explain: (v: unknown) => (calls.push(['explain', v]), Promise.resolve({ ok: 1 })) }
    },
    aggregate: (pipeline: unknown) => {
      calls.push(['aggregate', pipeline])
      return { explain: (v: unknown) => (calls.push(['explain', v]), Promise.resolve({ ok: 2 })) }
    }
  })
  return { db: { collection } as unknown as Db, calls }
}

describe('MongoDocumentQuery.explain', () => {
  it('explains a find filter with executionStats', async () => {
    const { db, calls } = fakeDb()
    const q = new MongoDocumentQuery(() => db)
    expect(await q.explain('shop', 'orders', 'find', { s: 'a' })).toEqual({ ok: 1 })
    expect(calls).toEqual([
      ['find', { s: 'a' }],
      ['explain', 'executionStats']
    ])
  })

  it('explains an aggregate pipeline with executionStats', async () => {
    const { db, calls } = fakeDb()
    const q = new MongoDocumentQuery(() => db)
    expect(await q.explain('shop', 'orders', 'aggregate', [{ $match: { s: 'a' } }])).toEqual({
      ok: 2
    })
    expect(calls).toEqual([
      ['aggregate', [{ $match: { s: 'a' } }]],
      ['explain', 'executionStats']
    ])
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { DbAdapter } from '../../src/shared/adapter/db-adapter'
import type { ConnectionProfile } from '../../src/shared/adapter/types'

interface Expected {
  database: string // e.g. 'app'
}

export function runDocumentAdapterContractTests(
  makeAdapter: () => DbAdapter,
  profile: ConnectionProfile,
  expected: Expected
): void {
  describe('DbAdapter document contract', () => {
    let adapter: DbAdapter
    const db = expected.database

    beforeAll(async () => {
      adapter = makeAdapter()
      await adapter.connect(profile)
    })
    afterAll(async () => {
      await adapter.disconnect()
    })

    it('lists databases and collections', async () => {
      expect(await adapter.listDatabases()).toContain(db)
      const tables = await adapter.listTables(db)
      expect(tables.some((t) => t.name === 'users')).toBe(true)
      expect(tables.some((t) => t.name === 'orders')).toBe(true)
    })
    it('samples fields as columns incl. _id', async () => {
      const cols = await adapter.getColumns(db, 'users')
      expect(cols.some((c) => c.name === '_id')).toBe(true)
      expect(cols.some((c) => c.name === 'email')).toBe(true)
    })
    it('reports the _id_ index', async () => {
      const idx = await adapter.getIndexes(db, 'users')
      expect(idx.some((i) => i.name === '_id_')).toBe(true)
    })
    it('executeQuery rejects (no SQL surface)', async () => {
      await expect(adapter.executeQuery('SELECT 1')).rejects.toThrow(/not SQL/i)
    })

    it('documentQuery: find with a filter + paging', async () => {
      if (!adapter.documentQuery) return
      const open = await adapter.documentQuery.find('orders', { status: 'open' }, {}, 500)
      let total = 0
      let done = false
      const q = open.queryId
      while (!done) {
        const page = await adapter.documentQuery.fetchDocs(q)
        total += page.docs.length
        done = page.done
      }
      expect(total).toBe(2500) // half the 5000 orders are 'open'
    })
    it('documentQuery: aggregate $group', async () => {
      if (!adapter.documentQuery) return
      const open = await adapter.documentQuery.aggregate(
        'orders',
        [{ $group: { _id: '$status', n: { $sum: 1 } } }],
        100
      )
      const page = await adapter.documentQuery.fetchDocs(open.queryId)
      expect(page.docs.length).toBe(2)
      await adapter.documentQuery.closeDocs(open.queryId)
    })
    it('documentQuery: close a cursor early without error', async () => {
      if (!adapter.documentQuery) return
      const open = await adapter.documentQuery.find('orders', {}, {}, 10)
      await adapter.documentQuery.closeDocs(open.queryId)
      await adapter.documentQuery.closeDocs(open.queryId) // idempotent
    })

    it('cancel closes in-flight cursors; stale id rejects, fresh query still works', async () => {
      if (!adapter.documentQuery) return
      const open = await adapter.documentQuery.find('orders', {}, {}, 10)
      await adapter.cancel()
      // The cancelled cursor's id is evicted → fetchDocs on it rejects.
      await expect(adapter.documentQuery.fetchDocs(open.queryId)).rejects.toThrow(
        /Unknown queryId/i
      )
      // A fresh query still works after cancel.
      const again = await adapter.documentQuery.find('users', {}, {}, 5)
      const page = await adapter.documentQuery.fetchDocs(again.queryId)
      expect(page.docs.length).toBe(5)
      await adapter.documentQuery.closeDocs(again.queryId)
    })
  })
}

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
      const open = await adapter.documentQuery.find('app', 'orders', { status: 'open' }, {}, 500)
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
        'app',
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
      const open = await adapter.documentQuery.find('app', 'orders', {}, {}, 10)
      await adapter.documentQuery.closeDocs(open.queryId)
      await adapter.documentQuery.closeDocs(open.queryId) // idempotent
    })

    it('cancel closes in-flight cursors; stale id rejects, fresh query still works', async () => {
      if (!adapter.documentQuery) return
      const open = await adapter.documentQuery.find('app', 'orders', {}, {}, 10)
      await adapter.cancel()
      // The cancelled cursor's id is evicted → fetchDocs on it rejects.
      await expect(adapter.documentQuery.fetchDocs(open.queryId)).rejects.toThrow(
        /Unknown queryId/i
      )
      // A fresh query still works after cancel.
      const again = await adapter.documentQuery.find('app', 'users', {}, {}, 5)
      const page = await adapter.documentQuery.fetchDocs(again.queryId)
      expect(page.docs.length).toBe(5)
      await adapter.documentQuery.closeDocs(again.queryId)
    })

    // Runs last: mutates the `users` collection, so it must not run before
    // the read-only assertions above (which pin exact counts/pages).
    it('documentMutator: insert → update → delete round-trip', async () => {
      if (!adapter.documentMutator || !adapter.documentQuery) return
      const dm = adapter.documentMutator
      const dq = adapter.documentQuery
      const ins = await dm.insertOne('app', 'users', {
        _id: 999999,
        email: 'z@z',
        name: 'Z'
      })
      expect(ins.insertedId).toBe(999999)

      const up = await dm.updateById('app', 'users', 999999, { name: 'Z2' })
      expect(up.matched).toBe(1)
      // Verify the field actually changed, not just that a doc matched.
      const afterUpdate = await dq.find('app', 'users', { _id: 999999 }, {}, 1)
      const updatedPage = await dq.fetchDocs(afterUpdate.queryId)
      expect(updatedPage.docs[0]?.name).toBe('Z2')

      const del = await dm.deleteById('app', 'users', 999999)
      expect(del.deleted).toBe(1)
      // Verify the doc is actually gone, not just that a count of 1 was reported.
      const afterDelete = await dq.find('app', 'users', { _id: 999999 }, {}, 1)
      const deletedPage = await dq.fetchDocs(afterDelete.queryId)
      expect(deletedPage.docs.length).toBe(0)
    })

    // Catches the bug where insertOne's auto-generated ObjectId insertedId
    // fails to survive the RPC structuredClone transport (loses its
    // prototype → becomes {buffer:...}), so a later update/delete by that id
    // silently matches 0 docs. Here we insert with NO explicit _id, so Mongo
    // auto-generates an ObjectId, and check the round trip end to end.
    it('documentMutator: insert without _id returns a JSON-safe insertedId that round-trips', async () => {
      if (!adapter.documentMutator) return
      const dm = adapter.documentMutator
      const ins = await dm.insertOne('app', 'users', { email: 'autoid@z', name: 'AutoId' })
      const id = ins.insertedId
      const isJsonSafeOid =
        typeof id === 'object' &&
        id !== null &&
        '$oid' in id &&
        typeof (id as { $oid: unknown }).$oid === 'string'
      const isPrimitive = typeof id === 'string' || typeof id === 'number'
      expect(isJsonSafeOid || isPrimitive).toBe(true)

      const del = await dm.deleteById('app', 'users', id)
      expect(del.deleted).toBe(1)
    })

    it('mongoStats: serverStatus snapshot', async () => {
      if (!adapter.mongoStats) return
      const snap = await adapter.mongoStats.serverStatus()
      expect(snap.connections.current).toBeGreaterThan(0)
      expect(typeof snap.opcounters.query).toBe('number')
    })
  })
}

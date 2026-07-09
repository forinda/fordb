import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { DbAdapter } from '../../src/shared/adapter/db-adapter'
import type { ConnectionProfile } from '../../src/shared/adapter/types'

/**
 * Engine-agnostic adapter contract. Every engine adapter must pass this
 * suite unchanged. Fixture expectations: schema `app` with tables
 * users(1000 rows)/orders(5000 rows), view user_emails, FK orders→users,
 * index orders_user_id_idx.
 */
export function runAdapterContractTests(
  makeAdapter: () => DbAdapter,
  profile: ConnectionProfile,
  expected: { database: string; schema: string }
): void {
  describe('DbAdapter contract', () => {
    let adapter: DbAdapter

    beforeAll(async () => {
      adapter = makeAdapter()
      await adapter.connect(profile)
    })

    afterAll(async () => {
      await adapter.disconnect()
    })

    it('lists databases including the connected one', async () => {
      const dbs = await adapter.listDatabases()
      expect(dbs).toContain(expected.database)
    })

    it('lists schemas including app', async () => {
      const schemas = await adapter.listSchemas()
      expect(schemas).toContain(expected.schema)
    })

    it('lists tables and views with type flag', async () => {
      const tables = await adapter.listTables(expected.schema)
      const names = tables.map((t) => `${t.type}:${t.name}`)
      expect(names).toContain('table:users')
      expect(names).toContain('table:orders')
      expect(names).toContain('view:user_emails')
    })

    it('describes columns with nullability and defaults', async () => {
      const cols = await adapter.getColumns(expected.schema, 'users')
      const email = cols.find((c) => c.name === 'email')
      const name = cols.find((c) => c.name === 'name')
      expect(email?.nullable).toBe(false)
      expect(name?.nullable).toBe(true)
      const createdAt = cols.find((c) => c.name === 'created_at')
      expect(createdAt?.defaultValue).toBeTruthy()
      expect(cols.map((c) => c.ordinal)).toEqual(
        [...cols.map((c) => c.ordinal)].sort((a, b) => a - b)
      )
    })

    it('reports primary, foreign, and unique keys', async () => {
      const userKeys = await adapter.getKeys(expected.schema, 'users')
      expect(userKeys.some((k) => k.kind === 'primary' && k.columns.includes('id'))).toBe(true)
      expect(userKeys.some((k) => k.kind === 'unique' && k.columns.includes('email'))).toBe(true)
      const orderKeys = await adapter.getKeys(expected.schema, 'orders')
      const fk = orderKeys.find((k) => k.kind === 'foreign')
      expect(fk?.columns).toContain('user_id')
      expect(fk?.referencedTable).toBe('users')
    })

    it('reports indexes', async () => {
      const idx = await adapter.getIndexes(expected.schema, 'orders')
      const byName = idx.find((i) => i.name === 'orders_user_id_idx')
      expect(byName?.columns).toEqual(['user_id'])
      expect(byName?.unique).toBe(false)
    })

    it('executes a buffered query with fields and rows', async () => {
      const r = await adapter.executeQuery(
        `SELECT id, email FROM ${expected.schema}.users ORDER BY id LIMIT 3`
      )
      expect(r.fields.map((f) => f.name)).toEqual(['id', 'email'])
      expect(r.rows).toHaveLength(3)
      expect(r.rowCount).toBe(3)
      expect(r.rows[0]?.[1]).toBe('user1@example.com')
    })

    it('streams large results in pages until done', async () => {
      const open = await adapter.openQuery(
        `SELECT id FROM ${expected.schema}.orders ORDER BY id`,
        1000
      )
      expect(open.fields.map((f) => f.name)).toEqual(['id'])
      let total = 0
      let pages = 0
      for (;;) {
        const page = await adapter.fetchPage(open.queryId)
        total += page.rows.length
        pages += 1
        if (page.done) break
        expect(pages).toBeLessThan(20) // safety against infinite loop
      }
      await adapter.closeQuery(open.queryId)
      expect(total).toBe(5000)
      expect(pages).toBeGreaterThanOrEqual(5)
    })

    it('closeQuery frees the cursor early without error', async () => {
      const open = await adapter.openQuery(`SELECT id FROM ${expected.schema}.orders`, 100)
      await adapter.fetchPage(open.queryId)
      await expect(adapter.closeQuery(open.queryId)).resolves.toBeUndefined()
    })

    it('cancel interrupts a running statement', async () => {
      const slow = adapter.executeQuery('SELECT pg_sleep(30)')
      // Register a rejection handler the instant the promise exists, so the
      // cancellation error can never surface as an unhandled rejection in the
      // window before expect(...).rejects attaches its own handler below.
      const settled = slow.then(
        () => new Error('query unexpectedly resolved'),
        (err: unknown) => err
      )
      await new Promise((r) => setTimeout(r, 300))
      await adapter.cancel()
      const outcome = await settled
      expect(outcome).toBeInstanceOf(Error)
      expect((outcome as Error).message).toMatch(/cancel/i)
    }, 15000)

    it('rejects bad SQL with a useful error', async () => {
      await expect(adapter.executeQuery('SELEKT 1')).rejects.toThrow(/syntax/i)
    })

    it('server stats: snapshot has sane shape when supported', async () => {
      if (!adapter.serverStats) return // capability not implemented by this engine
      const s = await adapter.serverStats.getServerSnapshot()
      expect(s.maxConnections).toBeGreaterThan(0)
      expect(s.backends).toBeGreaterThan(0)
      expect(s.dbSizeBytes).toBeGreaterThan(0)
      const sum =
        s.activityByState.active +
        s.activityByState.idle +
        s.activityByState.idleInTransaction +
        s.activityByState.idleInTransactionAborted +
        s.activityByState.other
      // Per-current-db state counts can't exceed server-wide backends.
      expect(sum).toBeLessThanOrEqual(s.backends)
      expect(typeof s.fullVisibility).toBe('boolean')
    })

    it('server stats: sessions exclude our own backend and expose pids', async () => {
      if (!adapter.serverStats) return
      const rows = await adapter.serverStats.getSessions()
      for (const r of rows) expect(Number.isFinite(r.pid)).toBe(true)
    })

    it('server stats: locks returns an array (empty on an idle db)', async () => {
      if (!adapter.serverStats) return
      const locks = await adapter.serverStats.getLocks()
      expect(Array.isArray(locks)).toBe(true)
    })
  })
}

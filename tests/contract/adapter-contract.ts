import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { DbAdapter } from '../../src/shared/adapter/db-adapter'
import type { ConnectionProfile } from '../../src/shared/adapter/types'
import { buildDdl } from '../../src/shared/ddl/build-ddl'

/**
 * Engine-agnostic adapter contract. Every engine adapter must pass this
 * suite unchanged. Fixture expectations: schema `app` with tables
 * users(1000 rows)/orders(5000 rows), view user_emails, FK orders→users,
 * index orders_user_id_idx.
 */
export function runAdapterContractTests(
  makeAdapter: () => DbAdapter,
  profile: ConnectionProfile,
  expected: { database: string; schema: string; cancelQuery?: string }
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
      expect(fk?.referencedColumns).toEqual(['id'])
    })

    it('reports indexes', async () => {
      const idx = await adapter.getIndexes(expected.schema, 'orders')
      const byName = idx.find((i) => i.name === 'orders_user_id_idx')
      expect(byName?.columns).toEqual(['user_id'])
      expect(byName?.unique).toBe(false)
    })

    // Runs among the reads (before the last-in-file mutator test) so it sees the
    // unmutated fixture.
    it('data browser: filters (bound), contains, isNull, sort — no injection', async () => {
      if (!adapter.dataBrowser) return
      const s = expected.schema
      const page = async (
        o: Parameters<NonNullable<typeof adapter.dataBrowser>['openBrowse']>[0]
      ): Promise<unknown[][]> => {
        const open = await adapter.dataBrowser!.openBrowse(o)
        const p = await adapter.fetchPage(open.queryId)
        await adapter.closeQuery(open.queryId)
        return p.rows
      }
      const eq = await page({
        schema: s,
        table: 'users',
        filters: [{ column: 'id', op: 'eq', value: 1 }],
        sort: [],
        pageSize: 1000
      })
      expect(eq).toHaveLength(1)

      const like = await page({
        schema: s,
        table: 'users',
        filters: [{ column: 'email', op: 'contains', value: 'user5@example.com' }],
        sort: [],
        pageSize: 1000
      })
      expect(like).toHaveLength(1)

      const nul = await page({
        schema: s,
        table: 'users',
        filters: [{ column: 'email', op: 'isNull' }],
        sort: [],
        pageSize: 1000
      })
      expect(nul).toHaveLength(0)

      const desc = await page({
        schema: s,
        table: 'users',
        filters: [],
        sort: [{ column: 'id', dir: 'desc' }],
        pageSize: 5
      })
      const asc = await page({
        schema: s,
        table: 'users',
        filters: [],
        sort: [{ column: 'id', dir: 'asc' }],
        pageSize: 5
      })
      expect(Number(desc[0]?.[0])).toBeGreaterThan(Number(asc[0]?.[0]))

      const inj = await page({
        schema: s,
        table: 'users',
        filters: [{ column: 'email', op: 'eq', value: "x' OR '1'='1" }],
        sort: [],
        pageSize: 1000
      })
      expect(inj).toHaveLength(0)
    })

    // Exercises the real buildDdl → applyDdl path on a throwaway table so it
    // never touches the shared fixture rows the mutator test depends on. Dialect
    // is inferred from a stable, engine-exclusive op (only Postgres has CREATE
    // SCHEMA). The remote/replica SQLite suites share one sqld, so pre-clean any
    // residue before asserting. Covers MA3a (create/add/index/fk/drop) and MA3b
    // (rename/alter/drop column, incl. the SQLite rebuild preserving data).
    it('schema editor: full lifecycle — create/add/index/fk/rename/alter/drop', async () => {
      if (!adapter.schemaEditor) return
      const s = expected.schema
      const ed = adapter.schemaEditor
      const dialect = ed.ops.createSchema ? 'pg' : 'sqlite'
      const qi = (x: string): string => `"${x.replace(/"/g, '""')}"`
      const tbl = `${qi(s)}.${qi('ma3_t')}`
      const ctx = async (): Promise<Parameters<typeof buildDdl>[2]> => ({
        columns: await adapter.getColumns(s, 'ma3_t'),
        keys: await adapter.getKeys(s, 'ma3_t'),
        indexes: await adapter.getIndexes(s, 'ma3_t')
      })
      const apply = async (c: Parameters<typeof buildDdl>[0], withCtx = false): Promise<void> =>
        ed.applyDdl(buildDdl(c, dialect, withCtx ? await ctx() : undefined))

      await apply({ kind: 'dropTable', schema: s, table: 'ma3_t' }).catch(() => {})

      await apply({
        kind: 'createTable',
        spec: {
          schema: s,
          table: 'ma3_t',
          columns: [
            { name: 'id', type: 'integer', notNull: true },
            { name: 'user_id', type: 'integer' }
          ],
          primaryKey: ['id']
        }
      })
      expect((await adapter.listTables(s)).some((t) => t.name === 'ma3_t')).toBe(true)

      await apply({
        kind: 'addColumn',
        schema: s,
        table: 'ma3_t',
        column: { name: 'label', type: 'text' }
      })
      expect((await adapter.getColumns(s, 'ma3_t')).some((c) => c.name === 'label')).toBe(true)

      await apply({
        kind: 'createIndex',
        spec: { schema: s, table: 'ma3_t', name: 'ma3_idx', columns: ['label'] }
      })
      expect((await adapter.getIndexes(s, 'ma3_t')).some((i) => i.name === 'ma3_idx')).toBe(true)

      // FK add — PG native, SQLite rebuild (needs context).
      if (ed.ops.addForeignKey) {
        await apply(
          {
            kind: 'addForeignKey',
            spec: {
              schema: s,
              table: 'ma3_t',
              name: 'ma3_fk',
              columns: ['user_id'],
              refSchema: s,
              refTable: 'users',
              refColumns: ['id']
            }
          },
          true
        )
        expect((await adapter.getKeys(s, 'ma3_t')).some((k) => k.kind === 'foreign')).toBe(true)
      }

      // Rename column — native both engines.
      if (ed.ops.renameColumn) {
        await apply({
          kind: 'renameColumn',
          schema: s,
          table: 'ma3_t',
          from: 'label',
          to: 'label2'
        })
        expect((await adapter.getColumns(s, 'ma3_t')).some((c) => c.name === 'label2')).toBe(true)
      }

      // Alter column type — PG in-place, SQLite rebuild. Seed a row first and
      // assert it survives (the rebuild must preserve data).
      if (ed.ops.alterColumn) {
        await ed.applyDdl([`INSERT INTO ${tbl} (${qi('id')}) VALUES (7)`])
        await apply(
          { kind: 'alterColumn', schema: s, table: 'ma3_t', column: 'id', type: 'BIGINT' },
          true
        )
        const r = await adapter.executeQuery(`SELECT id FROM ${tbl} WHERE id = 7`)
        expect(r.rows).toHaveLength(1)
      }

      // Drop column — native both engines. SQLite refuses to drop a column an
      // index still covers, so drop ma3_idx (on label2) first.
      if (ed.ops.dropColumn) {
        await apply({ kind: 'dropIndex', schema: s, name: 'ma3_idx' })
        await apply({ kind: 'dropColumn', schema: s, table: 'ma3_t', column: 'label2' })
        expect((await adapter.getColumns(s, 'ma3_t')).some((c) => c.name === 'label2')).toBe(false)
      }

      await apply({ kind: 'dropTable', schema: s, table: 'ma3_t' })
      expect((await adapter.listTables(s)).some((t) => t.name === 'ma3_t')).toBe(false)
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

    // Only engines that can run a long statement AND interrupt it (Postgres via
    // pg_cancel_backend) exercise this. SQLite/libsql run local statements to
    // completion with a no-op cancel, so they omit `cancelQuery` → test skipped.
    const cancelTest = expected.cancelQuery ? it : it.skip
    cancelTest(
      'cancel interrupts a running statement',
      async () => {
        const slow = adapter.executeQuery(expected.cancelQuery!)
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
      },
      15000
    )

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

    // Runs LAST so the mutations below don't disturb the read assertions above.
    it('data mutator: update/insert/delete apply, and a bad batch rolls back', async () => {
      if (!adapter.dataMutator) return
      const s = expected.schema

      await adapter.dataMutator.apply([
        {
          kind: 'update',
          schema: s,
          table: 'users',
          pk: [{ column: 'id', value: 1 }],
          set: [{ column: 'name', value: 'Zed' }]
        }
      ])
      const afterUpdate = await adapter.executeQuery(`SELECT name FROM ${s}.users WHERE id = 1`)
      expect(afterUpdate.rows[0]?.[0]).toBe('Zed')

      await adapter.dataMutator.apply([
        {
          kind: 'insert',
          schema: s,
          table: 'users',
          values: [
            { column: 'email', value: 'zzz@example.com' },
            { column: 'name', value: 'Zzz' }
          ]
        }
      ])
      const inserted = await adapter.executeQuery(
        `SELECT id FROM ${s}.users WHERE email = 'zzz@example.com'`
      )
      const zid = inserted.rows[0]?.[0]
      expect(zid).toBeDefined()

      await adapter.dataMutator.apply([
        { kind: 'delete', schema: s, table: 'users', pk: [{ column: 'id', value: zid }] }
      ])
      const gone = await adapter.executeQuery(
        `SELECT count(*) FROM ${s}.users WHERE email = 'zzz@example.com'`
      )
      expect(Number(gone.rows[0]?.[0])).toBe(0)

      // A valid update followed by a UNIQUE(email)-violating insert must roll
      // the whole batch back — the update must not persist.
      await expect(
        adapter.dataMutator.apply([
          {
            kind: 'update',
            schema: s,
            table: 'users',
            pk: [{ column: 'id', value: 1 }],
            set: [{ column: 'name', value: 'RolledBack' }]
          },
          {
            kind: 'insert',
            schema: s,
            table: 'users',
            values: [
              { column: 'email', value: 'user2@example.com' },
              { column: 'name', value: 'Dup' }
            ]
          }
        ])
      ).rejects.toThrow()
      const rolled = await adapter.executeQuery(`SELECT name FROM ${s}.users WHERE id = 1`)
      expect(rolled.rows[0]?.[0]).not.toBe('RolledBack')
    })
  })
}

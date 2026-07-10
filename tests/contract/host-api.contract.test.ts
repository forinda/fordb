import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConnectionRegistry } from '../../src/db-host/connection-registry'
import { HostApiImpl } from '../../src/db-host/host-api-impl'
import { adapterForEngine } from '../../src/db-host/adapter-factory'
import { serveRpc } from '../../src/shared/rpc/server'
import { createRpcClient } from '../../src/shared/rpc/client'
import type { PortLike } from '../../src/shared/rpc/protocol'
import type { HostApi } from '../../src/shared/host/host-api'
import type { ConnectionProfile, MongoProfile } from '../../src/shared/adapter/types'
import { seedMongoFixture } from './mongo-fixture'
import { buildMongoUri } from '../../src/db-host/mongo/mongo-config'

const profile: ConnectionProfile = {
  id: 'p1',
  name: 't',
  engine: 'postgres',
  host: '127.0.0.1',
  port: 54329,
  database: 'fordb_test',
  user: 'fordb',
  password: 'fordb'
}
const badProfile: ConnectionProfile = { ...profile, password: 'wrong' }

const mongoProfile: MongoProfile = {
  id: 'm',
  name: 'mongo',
  engine: 'mongodb',
  uri: 'mongodb://localhost:27027/',
  database: 'app'
}

function nodePort(p: import('node:worker_threads').MessagePort): PortLike {
  return { postMessage: (m) => p.postMessage(m), onMessage: (cb) => p.on('message', cb) }
}

beforeAll(async () => {
  const c = new pg.Client({
    host: '127.0.0.1',
    port: 54329,
    database: 'fordb_test',
    user: 'fordb',
    password: 'fordb'
  })
  await c.connect()
  await c.query(readFileSync(join(__dirname, 'fixture.sql'), 'utf8'))
  await c.end()
  // Seed the Mongo fixture too, so this file's documentQuery assertions pass
  // when run in isolation (not just as part of the full `test:contract` run).
  // NOTE (T5): this shares the `app` database with mongodb.contract.test.ts's
  // seed. That's only safe because vitest.contract.config.ts sets
  // `fileParallelism: false` — these files never run concurrently. If
  // parallelism is ever revisited, make this seed idempotent-safe (or give
  // each file its own DB) first.
  await seedMongoFixture(buildMongoUri(mongoProfile))
})

describe('HostApi over RPC', () => {
  let client: HostApi
  let ports: import('node:worker_threads').MessagePort[]
  let registry: ConnectionRegistry

  beforeAll(() => {
    let n = 0
    registry = new ConnectionRegistry(
      (engine) => adapterForEngine(engine),
      () => `c${++n}`
    )
    const { port1, port2 } = new MessageChannel()
    ports = [port1, port2]
    serveRpc(nodePort(port1), new HostApiImpl(registry))
    client = createRpcClient<HostApi>(nodePort(port2))
  })
  afterAll(async () => {
    await registry.closeAll()
    ports.forEach((p) => p.close())
  })

  it('testConnection ok on good profile', async () => {
    expect(await client.testConnection(profile)).toEqual({ ok: true })
  })

  it('testConnection reports error on bad credentials without throwing', async () => {
    const r = await client.testConnection(badProfile)
    expect(r.ok).toBe(false)
  })

  it('testConnection ok on a good Mongo profile (I1: engine-agnostic probe)', async () => {
    expect(await client.testConnection(mongoProfile)).toEqual({ ok: true })
  })

  it('open then introspect by connectionId', async () => {
    const id = await client.openConnection(profile)
    expect(await client.listSchemas(id)).toContain('app')
    const tables = await client.listTables(id, 'app')
    expect(tables.map((t) => t.name)).toContain('users')
    await client.closeConnection(id)
  })

  it('introspect on unknown id rejects', async () => {
    await expect(client.listSchemas('nope')).rejects.toThrow(/unknown connection/i)
  })

  it('exposes server stats over the HostApi', async () => {
    const id = await client.openConnection(profile)
    expect(await client.serverStatsSupported(id)).toBe(true)
    const snap = await client.getServerSnapshot(id)
    expect(snap.maxConnections).toBeGreaterThan(0)
    expect(Array.isArray(await client.getSessions(id))).toBe(true)
    expect(Array.isArray(await client.getLocks(id))).toBe(true)
    await client.closeConnection(id)
  })

  it('exposes data mutation over the HostApi', async () => {
    const id = await client.openConnection(profile)
    expect(await client.mutationSupported(id)).toBe(true)
    await client.applyEdits(id, [
      {
        kind: 'update',
        schema: 'app',
        table: 'users',
        pk: [{ column: 'id', value: 3 }],
        set: [{ column: 'name', value: 'Via HostApi' }]
      }
    ])
    const r = await client.executeQuery(id, `SELECT name FROM app.users WHERE id = 3`)
    expect(r.rows[0]?.[0]).toBe('Via HostApi')
    await client.closeConnection(id)
  })

  it('exposes data browse over the HostApi', async () => {
    const id = await client.openConnection(profile)
    expect(await client.browseSupported(id)).toBe(true)
    const open = await client.openBrowse(id, {
      schema: 'app',
      table: 'users',
      filters: [{ column: 'id', op: 'eq', value: 1 }],
      sort: [],
      pageSize: 1000
    })
    const page = await client.fetchPage(id, open.queryId)
    await client.closeQuery(id, open.queryId)
    expect(page.rows).toHaveLength(1)
    await client.closeConnection(id)
  })

  it('applies DDL over the HostApi (create + drop a temp table)', async () => {
    const id = await client.openConnection(profile)
    expect(await client.schemaEditSupported(id)).toBe(true)
    const ops = await client.schemaOps(id)
    expect(ops.createTable).toBe(true)
    await client.applyDdl(id, [`DROP TABLE app.ma3_hostapi`]).catch(() => {})
    await client.applyDdl(id, [
      `CREATE TABLE app.ma3_hostapi ("id" integer NOT NULL, PRIMARY KEY ("id"))`
    ])
    expect((await client.listTables(id, 'app')).some((t) => t.name === 'ma3_hostapi')).toBe(true)
    await client.applyDdl(id, [`DROP TABLE app.ma3_hostapi`])
    await client.closeConnection(id)
  })

  it('executeScript runs statements in one transaction; rolls back on error', async () => {
    const id = await client.openConnection(profile)
    await client.executeScript(id, [`DROP TABLE app.ma5_s`]).catch(() => {})
    await client.executeScript(id, [
      `CREATE TABLE app.ma5_s ("id" integer NOT NULL, PRIMARY KEY ("id"))`,
      `INSERT INTO app.ma5_s ("id") VALUES (1)`,
      `INSERT INTO app.ma5_s ("id") VALUES (2)`
    ])
    const r = await client.executeQuery(id, `SELECT count(*) FROM app.ma5_s`)
    expect(Number(r.rows[0]?.[0])).toBe(2)
    // A failing statement rolls back the whole batch.
    await expect(
      client.executeScript(id, [
        `INSERT INTO app.ma5_s ("id") VALUES (3)`,
        `INSERT INTO app.ma5_s ("id") VALUES (1)` // pk conflict
      ])
    ).rejects.toThrow()
    const r2 = await client.executeQuery(id, `SELECT count(*) FROM app.ma5_s`)
    expect(Number(r2.rows[0]?.[0])).toBe(2) // 3 was rolled back
    await client.executeScript(id, [`DROP TABLE app.ma5_s`])
    await client.closeConnection(id)
  })

  it('lists objects + a view definition over the HostApi', async () => {
    const id = await client.openConnection(profile)
    expect(await client.objectsSupported(id)).toBe(true)
    expect(await client.objectKinds(id)).toContain('view')
    expect(
      (await client.listObjects(id, 'app', 'view')).some((v) => v.name === 'user_emails')
    ).toBe(true)
    expect(await client.objectDefinition(id, 'app', 'view', 'user_emails')).toMatch(/select/i)
    await client.closeConnection(id)
  })

  it('exposes server admin over the HostApi', async () => {
    const id = await client.openConnection(profile)
    expect(await client.serverAdminSupported(id)).toBe(true)
    expect((await client.listRoles(id)).some((r) => r.name === 'fordb')).toBe(true)
    expect((await client.serverSettings(id)).some((s) => s.name === 'max_connections')).toBe(true)
    const grants = await client.roleGrants(id, 'fordb')
    expect(
      grants.some((g) => g.schema === 'app' && g.table === 'users' && g.privilege === 'SELECT')
    ).toBe(true)
    expect(await client.cancelBackend(id, 0)).toBe(false)
    expect(await client.terminateBackend(id, 0)).toBe(false)
    // Postgres has no documentQuery capability — pin the negative here.
    expect(await client.documentQuerySupported(id)).toBe(false)
    await client.closeConnection(id)
  })

  it('exposes documentQuery over the HostApi when supported', async () => {
    const mid = await client.openConnection(mongoProfile)
    expect(await client.documentQuerySupported(mid)).toBe(true)
    const open = await client.findDocs(mid, 'app', 'orders', { status: 'open' }, { limit: 10 }, 10)
    const page = await client.fetchDocs(mid, open.queryId)
    expect(page.docs.length).toBe(10)
    await client.closeDocs(mid, open.queryId)
    await client.closeConnection(mid)
  })

  // Runs last: mutates the `users` collection shared with the seed above.
  it('exposes documentMutator over the HostApi when supported (insert/update/delete)', async () => {
    const mid = await client.openConnection(mongoProfile)
    expect(await client.documentMutatorSupported(mid)).toBe(true)
    const ins = await client.insertDoc(mid, 'app', 'users', {
      _id: 999998,
      email: 'hostapi@z',
      name: 'HostApi Z'
    })
    expect(ins.insertedId).toBe(999998)

    const up = await client.updateDoc(mid, 'app', 'users', 999998, { name: 'HostApi Z2' })
    expect(up.matched).toBe(1)
    // Verify the field actually changed, not just that a doc matched.
    const afterUpdate = await client.findDocs(mid, 'app', 'users', { _id: 999998 }, {}, 1)
    const updatedPage = await client.fetchDocs(mid, afterUpdate.queryId)
    expect(updatedPage.docs[0]?.name).toBe('HostApi Z2')

    const del = await client.deleteDoc(mid, 'app', 'users', 999998)
    expect(del.deleted).toBe(1)
    // Verify the doc is actually gone, not just that a count of 1 was reported.
    const afterDelete = await client.findDocs(mid, 'app', 'users', { _id: 999998 }, {}, 1)
    const deletedPage = await client.fetchDocs(mid, afterDelete.queryId)
    expect(deletedPage.docs.length).toBe(0)

    await client.closeConnection(mid)
  })

  // Catches the bug where insertOne's auto-generated ObjectId insertedId
  // fails to survive the RPC structuredClone transport (loses its prototype
  // → becomes {buffer:...}), so a later update/delete by that id silently
  // matches 0 docs. Insert with no explicit _id, so Mongo auto-generates an
  // ObjectId, and check the round trip via the actual RPC transport.
  it('documentMutator insertDoc without _id returns a JSON-safe insertedId that round-trips over RPC', async () => {
    const mid = await client.openConnection(mongoProfile)
    const ins = await client.insertDoc(mid, 'app', 'users', {
      email: 'autoid-hostapi@z',
      name: 'AutoId'
    })
    const id = ins.insertedId
    const isJsonSafeOid =
      typeof id === 'object' &&
      id !== null &&
      '$oid' in id &&
      typeof (id as { $oid: unknown }).$oid === 'string'
    const isPrimitive = typeof id === 'string' || typeof id === 'number'
    expect(isJsonSafeOid || isPrimitive).toBe(true)

    const del = await client.deleteDoc(mid, 'app', 'users', id)
    expect(del.deleted).toBe(1)
    await client.closeConnection(mid)
  })
})

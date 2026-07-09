import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConnectionRegistry } from '../../src/db-host/connection-registry'
import { HostApiImpl } from '../../src/db-host/host-api-impl'
import { PostgresAdapter } from '../../src/db-host/postgres/postgres-adapter'
import { serveRpc } from '../../src/shared/rpc/server'
import { createRpcClient } from '../../src/shared/rpc/client'
import type { PortLike } from '../../src/shared/rpc/protocol'
import type { HostApi } from '../../src/shared/host/host-api'
import type { ConnectionProfile } from '../../src/shared/adapter/types'

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
})

describe('HostApi over RPC', () => {
  let client: HostApi
  let ports: import('node:worker_threads').MessagePort[]
  let registry: ConnectionRegistry

  beforeAll(() => {
    let n = 0
    registry = new ConnectionRegistry(
      () => new PostgresAdapter(),
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
})

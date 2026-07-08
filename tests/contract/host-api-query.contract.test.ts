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
describe('HostApi query routing', () => {
  let client: HostApi
  let ports: import('node:worker_threads').MessagePort[]
  let registry: ConnectionRegistry
  let id: string
  beforeAll(async () => {
    let n = 0
    registry = new ConnectionRegistry(
      () => new PostgresAdapter(),
      () => `c${++n}`
    )
    const { port1, port2 } = new MessageChannel()
    ports = [port1, port2]
    serveRpc(nodePort(port1), new HostApiImpl(registry))
    client = createRpcClient<HostApi>(nodePort(port2))
    id = await client.openConnection(profile)
  })
  afterAll(async () => {
    await registry.closeAll()
    ports.forEach((p) => p.close())
  })

  it('executeQuery returns buffered rows', async () => {
    const r = await client.executeQuery(id, 'SELECT id, email FROM app.users ORDER BY id LIMIT 2')
    expect(r.fields.map((f) => f.name)).toEqual(['id', 'email'])
    expect(r.rows).toHaveLength(2)
  })
  it('openQuery/fetchPage streams all rows', async () => {
    const open = await client.openQuery(id, 'SELECT id FROM app.orders ORDER BY id', 1000)
    expect(open.fields.map((f) => f.name)).toEqual(['id'])
    let total = 0
    for (;;) {
      const page = await client.fetchPage(id, open.queryId)
      total += page.rows.length
      if (page.done) break
    }
    await client.closeQuery(id, open.queryId)
    expect(total).toBe(5000)
  })
  it('cancel interrupts a running statement', async () => {
    const slow = client.executeQuery(id, 'SELECT pg_sleep(30)')
    const settled = slow.then(
      () => new Error('resolved'),
      (e: unknown) => e
    )
    await new Promise((r) => setTimeout(r, 300))
    await client.cancel(id)
    const outcome = await settled
    expect(outcome).toBeInstanceOf(Error)
    expect((outcome as Error).message).toMatch(/cancel/i)
  }, 15000)
  it('unknown connectionId rejects', async () => {
    await expect(client.executeQuery('nope', 'SELECT 1')).rejects.toThrow(/unknown connection/i)
  })
})

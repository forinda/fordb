import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConnectionRegistry } from '../../src/db-host/connection-registry'
import { PostgresAdapter } from '../../src/db-host/postgres/postgres-adapter'
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

function makeRegistry(): ConnectionRegistry {
  let n = 0
  return new ConnectionRegistry(
    () => new PostgresAdapter(),
    () => `c${++n}`
  )
}

describe('ConnectionRegistry', () => {
  let reg: ConnectionRegistry
  afterEach(async () => {
    await reg?.closeAll()
  })

  it('open returns distinct ids and get resolves the adapter', async () => {
    reg = makeRegistry()
    const a = await reg.open(profile)
    const b = await reg.open(profile)
    expect(a).not.toBe(b)
    const dbs = await reg.get(a).listDatabases()
    expect(dbs).toContain('fordb_test')
  })

  it('close disconnects and removes the entry', async () => {
    reg = makeRegistry()
    const id = await reg.open(profile)
    await reg.close(id)
    expect(() => reg.get(id)).toThrow(/unknown connection/i)
  })

  it('close is idempotent', async () => {
    reg = makeRegistry()
    const id = await reg.open(profile)
    await reg.close(id)
    await expect(reg.close(id)).resolves.toBeUndefined()
  })

  it('get throws on unknown id', () => {
    reg = makeRegistry()
    expect(() => reg.get('nope')).toThrow(/unknown connection/i)
  })

  it('two connections are isolated', async () => {
    reg = makeRegistry()
    const a = await reg.open(profile)
    const b = await reg.open(profile)
    const [ra, rb] = await Promise.all([reg.get(a).listSchemas(), reg.get(b).listSchemas()])
    expect(ra).toContain('app')
    expect(rb).toContain('app')
  })
})

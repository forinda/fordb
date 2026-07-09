import { runAdapterContractTests } from './adapter-contract'
import { PostgresAdapter } from '../../src/db-host/postgres/postgres-adapter'
import type { ConnectionProfile } from '../../src/shared/adapter/types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll } from 'vitest'
import pg from 'pg'

const profile: ConnectionProfile = {
  id: 'test',
  name: 'contract-test',
  engine: 'postgres',
  host: '127.0.0.1',
  port: 54329,
  database: 'fordb_test',
  user: 'fordb',
  password: 'fordb'
}

beforeAll(async () => {
  const client = new pg.Client({
    host: profile.host,
    port: profile.port,
    database: profile.database,
    user: profile.user,
    password: profile.password
  })
  await client.connect()
  await client.query(readFileSync(join(__dirname, 'fixture.sql'), 'utf8'))
  await client.end()
})

runAdapterContractTests(() => new PostgresAdapter(), profile, {
  database: 'fordb_test',
  schema: 'app'
})

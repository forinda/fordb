import { beforeAll } from 'vitest'
import { runAdapterContractTests } from './adapter-contract'
import { SqliteAdapter } from '../../src/db-host/sqlite/sqlite-adapter'
import { seedSqld } from './sqld-seed'
import type { SqliteProfile } from '../../src/shared/adapter/types'

const URL = 'http://127.0.0.1:8080'
const profile: SqliteProfile = {
  id: 'sr',
  name: 'sqlite-remote',
  engine: 'sqlite',
  kind: 'remote',
  url: URL
}

beforeAll(async () => {
  await seedSqld(URL)
})

runAdapterContractTests(() => new SqliteAdapter(), profile, { database: 'main', schema: 'main' })

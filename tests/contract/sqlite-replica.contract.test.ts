import { beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAdapterContractTests } from './adapter-contract'
import { SqliteAdapter } from '../../src/db-host/sqlite/sqlite-adapter'
import { seedSqld } from './sqld-seed'
import type { SqliteProfile } from '../../src/shared/adapter/types'

const SYNC_URL = 'http://127.0.0.1:8080'
// The adapter connect()s and sync()s the replica once; the shared contract then
// reads from the synced local snapshot.
const file = join(mkdtempSync(join(tmpdir(), 'fordb-replica-')), 'replica.sqlite')
const profile: SqliteProfile = {
  id: 'srep',
  name: 'sqlite-replica',
  engine: 'sqlite',
  kind: 'replica',
  file,
  syncUrl: SYNC_URL
}

beforeAll(async () => {
  await seedSqld(SYNC_URL)
})

runAdapterContractTests(() => new SqliteAdapter(), profile, { database: 'main', schema: 'main' })

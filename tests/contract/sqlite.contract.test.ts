import { beforeAll } from 'vitest'
import { runAdapterContractTests } from './adapter-contract'
import { SqliteAdapter } from '../../src/db-host/sqlite/sqlite-adapter'
import { buildSqliteFixture } from './sqlite-fixture'
import type { SqliteProfile } from '../../src/shared/adapter/types'

// Single-file fixture: the mirrored tables live in `main`, so the shared
// contract runs with schema='main' (SQLite's default namespace). No ATTACH
// needed — a real user's single .sqlite file behaves identically.
//
// `profile` is captured by reference here and its `file` is filled in the
// beforeAll below, which runs BEFORE the contract's own beforeAll (which does
// adapter.connect(profile)) because root-suite hooks run before child-suite
// hooks.
const profile: SqliteProfile = { id: 's', name: 'sqlite-contract', engine: 'sqlite', file: '' }

beforeAll(async () => {
  profile.file = await buildSqliteFixture()
})

runAdapterContractTests(() => new SqliteAdapter(), profile, { database: 'main', schema: 'main' })

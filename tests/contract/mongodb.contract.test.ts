import { beforeAll } from 'vitest'
import { runDocumentAdapterContractTests } from './document-adapter-contract'
import { MongoAdapter } from '../../src/db-host/mongo/mongo-adapter'
import { seedMongoFixture } from './mongo-fixture'
import { buildMongoUri } from '../../src/db-host/mongo/mongo-config'
import type { MongoProfile } from '../../src/shared/adapter/types'

const profile: MongoProfile = {
  id: 'm',
  name: 'mongo-contract',
  engine: 'mongodb',
  uri: 'mongodb://localhost:27027/',
  database: 'app'
}

// NOTE (T5): this seed shares the `app` database with
// host-api.contract.test.ts's seed of the same DB. That's only safe because
// vitest.contract.config.ts sets `fileParallelism: false` — these files never
// run concurrently. If parallelism is ever revisited, make this seed
// idempotent-safe (or give each file its own DB) first.
beforeAll(async () => {
  await seedMongoFixture(buildMongoUri(profile))
})

runDocumentAdapterContractTests(() => new MongoAdapter(), profile, { database: 'app' })

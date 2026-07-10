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

beforeAll(async () => {
  await seedMongoFixture(buildMongoUri(profile))
})

runDocumentAdapterContractTests(() => new MongoAdapter(), profile, { database: 'app' })

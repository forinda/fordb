import { MongoClient } from 'mongodb'

/** Seed DB `app` with users(1000)/orders(5000) mirroring the relational
 *  fixture, so document assertions parallel the SQL ones. */
export async function seedMongoFixture(uri: string): Promise<void> {
  const client = new MongoClient(uri)
  await client.connect()
  try {
    const db = client.db('app')
    await db
      .collection('users')
      .drop()
      .catch(() => {})
    await db
      .collection('orders')
      .drop()
      .catch(() => {})
    await db.collection<{ _id: number; email: string; name: string }>('users').insertMany(
      Array.from({ length: 1000 }, (_, i) => ({
        _id: i + 1,
        email: `user${i + 1}@example.com`,
        name: `User ${i + 1}`
      }))
    )
    await db.collection('orders').insertMany(
      Array.from({ length: 5000 }, (_, i) => ({
        userId: (i % 1000) + 1,
        amount: (i % 500) / 10,
        status: i % 2 ? 'open' : 'closed'
      }))
    )
    await db.collection('users').createIndex({ email: 1 }, { unique: true })
  } finally {
    await client.close()
  }
}

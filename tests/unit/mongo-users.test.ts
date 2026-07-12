import { describe, it, expect } from 'vitest'
import type { Db } from 'mongodb'
import { MongoUserAdmin } from '../../src/db-host/mongo/mongo-users'

function fakeDb(usersResult?: unknown): { db: Db; calls: unknown[][] } {
  const calls: unknown[][] = []
  const db = {
    command: (cmd: Record<string, unknown>) => {
      calls.push(['command', cmd])
      if ('usersInfo' in cmd) return Promise.resolve(usersResult ?? { users: [] })
      return Promise.resolve({ ok: 1 })
    }
  }
  return { db: db as unknown as Db, calls }
}

describe('MongoUserAdmin', () => {
  it('listUsers maps the usersInfo result', async () => {
    const { db } = fakeDb({
      users: [{ user: 'app', roles: [{ role: 'readWrite', db: 'shop' }] }]
    })
    expect(await new MongoUserAdmin(() => db).listUsers('shop')).toEqual([
      { user: 'app', roles: [{ role: 'readWrite', db: 'shop' }] }
    ])
  })

  it('createUser issues createUser with pwd + roles bound to the db', async () => {
    const { db, calls } = fakeDb()
    await new MongoUserAdmin(() => db).createUser('shop', 'app', 's3cret', ['readWrite', 'dbAdmin'])
    expect(calls).toEqual([
      [
        'command',
        {
          createUser: 'app',
          pwd: 's3cret',
          roles: [
            { role: 'readWrite', db: 'shop' },
            { role: 'dbAdmin', db: 'shop' }
          ]
        }
      ]
    ])
  })

  it('dropUser issues dropUser', async () => {
    const { db, calls } = fakeDb()
    await new MongoUserAdmin(() => db).dropUser('shop', 'app')
    expect(calls).toEqual([['command', { dropUser: 'app' }]])
  })
})

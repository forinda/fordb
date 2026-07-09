import { describe, it, expect } from 'vitest'
import { adapterForEngine } from '../../src/db-host/adapter-factory'
import { PostgresAdapter } from '../../src/db-host/postgres/postgres-adapter'
import { SqliteAdapter } from '../../src/db-host/sqlite/sqlite-adapter'

describe('adapterForEngine', () => {
  it('returns a PostgresAdapter for postgres', () => {
    expect(adapterForEngine('postgres')).toBeInstanceOf(PostgresAdapter)
  })
  it('returns a SqliteAdapter for sqlite', () => {
    expect(adapterForEngine('sqlite')).toBeInstanceOf(SqliteAdapter)
  })
})

import type { DbAdapter } from '@shared/adapter/db-adapter'
import type { ConnectionProfile } from '@shared/adapter/types'
import { PostgresAdapter } from './postgres/postgres-adapter'
import { SqliteAdapter } from './sqlite/sqlite-adapter'

/** The single place engine → adapter is resolved. Used by the ConnectionRegistry
 *  and by testConnection. A new engine is added here and nowhere else. */
export function adapterForEngine(engine: ConnectionProfile['engine']): DbAdapter {
  switch (engine) {
    case 'postgres':
      return new PostgresAdapter()
    case 'sqlite':
      return new SqliteAdapter()
    case 'mongodb':
      throw new Error('MongoDB not yet wired')
  }
}

import type { Config } from '@libsql/client'
import type { SqliteProfile } from '@shared/adapter/types'

/** Maps a SqliteProfile to a libsql client Config. Pure — the adapter injects
 *  the actual client factory (see sqlite-adapter). */
export function configFor(profile: SqliteProfile): Config {
  switch (profile.kind) {
    case 'local':
      return { url: `file:${profile.file}` }
    case 'remote':
      return { url: profile.url, authToken: profile.authToken }
    case 'replica':
      return { url: `file:${profile.file}`, syncUrl: profile.syncUrl, authToken: profile.authToken }
  }
}

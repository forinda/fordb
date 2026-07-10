import type { ConnectionProfile } from './adapter/types'
import { connectionLabel } from './connection-label'

export interface ProfileFilter {
  engine?: ConnectionProfile['engine']
  environment?: 'production' | 'staging' | 'local'
  favoritesOnly?: boolean
  /** Case-insensitive match over name + connectionLabel. */
  search?: string
}

/** Non-secret searchable address parts per engine. The Mongo `uri` is
 *  deliberately excluded — it can embed credentials. */
function addressParts(p: ConnectionProfile): string[] {
  switch (p.engine) {
    case 'postgres':
      return [p.host, p.database]
    case 'sqlite':
      return p.kind === 'local' ? [p.file] : p.kind === 'remote' ? [p.url] : [p.file, p.syncUrl]
    case 'mongodb':
      return [p.host ?? '', p.database ?? '']
  }
}

export function filterProfiles(
  profiles: ConnectionProfile[],
  filter: ProfileFilter
): ConnectionProfile[] {
  const q = filter.search?.trim().toLowerCase()
  return profiles.filter((p) => {
    if (filter.engine && p.engine !== filter.engine) return false
    if (filter.environment && p.environment !== filter.environment) return false
    if (filter.favoritesOnly && !p.favorite) return false
    if (q) {
      const hay = [p.name, connectionLabel(p), ...addressParts(p)].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

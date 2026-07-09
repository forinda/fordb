import type { ConnectionProfile } from './adapter/types'

/**
 * A human label for a connection profile. Profiles can be saved without a name
 * (the form's name field is optional, and URL-import doesn't set one), so fall
 * back to `user@host/database` — otherwise the sidebar row would be blank and
 * the connection effectively invisible.
 */
export function connectionLabel(profile: ConnectionProfile): string {
  const name = profile.name.trim()
  if (name) return name
  if (profile.engine === 'sqlite') {
    const base = profile.file.split(/[\\/]/).pop() ?? profile.file
    return base || 'SQLite database'
  }
  const host = profile.host.trim()
  const user = profile.user.trim()
  const database = profile.database.trim()
  if (!host && !user && !database) return 'Unnamed connection'
  const left = user ? `${user}@${host}` : host
  return database ? `${left}/${database}` : left
}

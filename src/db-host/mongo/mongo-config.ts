import type { MongoProfile } from '@shared/adapter/types'

/** Reconcile a MongoProfile to a connection URI. URI path wins verbatim;
 *  otherwise assemble mongodb://[user:pass@]host:port/?authSource=…&tls=…
 *  Pure — the adapter injects the MongoClient factory. */
export function buildMongoUri(profile: MongoProfile): string {
  if (profile.uri) return profile.uri
  if (!profile.host) throw new Error('MongoProfile needs a uri or host')
  const port = profile.port ?? 27017
  const cred =
    profile.user != null
      ? `${encodeURIComponent(profile.user)}:${encodeURIComponent(profile.password ?? '')}@`
      : ''
  const opts: string[] = []
  if (profile.authSource) opts.push(`authSource=${encodeURIComponent(profile.authSource)}`)
  if (profile.tls) opts.push('tls=true')
  const query = opts.length ? `?${opts.join('&')}` : ''
  return `mongodb://${cred}${profile.host}:${port}/${query}`
}

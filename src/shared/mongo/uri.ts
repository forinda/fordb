/** Bidirectional MongoDB URI ↔ discrete-fields mapping (Compass-style form
 *  sync). Pure; no engine access. Single-host only — the first host is
 *  parsed, which matches the MongoProfile shape. */

export interface MongoUriFields {
  srv: boolean
  host: string
  /** null for mongodb+srv (the scheme forbids ports). */
  port: number | null
  user: string
  password: string
  database: string
  authSource: string
  tls: boolean
}

export function parseMongoUri(uri: string): MongoUriFields | null {
  const m = /^mongodb(\+srv)?:\/\/(.*)$/.exec(uri.trim())
  if (!m) return null
  const srv = Boolean(m[1])
  let rest = m[2]!
  if (!rest) return null

  let user = ''
  let password = ''
  const at = rest.lastIndexOf('@')
  if (at >= 0) {
    const cred = rest.slice(0, at)
    rest = rest.slice(at + 1)
    const colon = cred.indexOf(':')
    try {
      user = decodeURIComponent(colon >= 0 ? cred.slice(0, colon) : cred)
      password = decodeURIComponent(colon >= 0 ? cred.slice(colon + 1) : '')
    } catch {
      return null
    }
  }

  let query = ''
  const q = rest.indexOf('?')
  if (q >= 0) {
    query = rest.slice(q + 1)
    rest = rest.slice(0, q)
  }
  let database = ''
  const slash = rest.indexOf('/')
  if (slash >= 0) {
    database = decodeURIComponent(rest.slice(slash + 1))
    rest = rest.slice(0, slash)
  }
  // Multi-host lists: take the first (profile is single-host).
  const firstHost = rest.split(',')[0] ?? ''
  if (!firstHost) return null
  let host = firstHost
  let port: number | null = srv ? null : 27017
  const pcolon = firstHost.lastIndexOf(':')
  if (pcolon >= 0 && !srv) {
    host = firstHost.slice(0, pcolon)
    const p = Number(firstHost.slice(pcolon + 1))
    if (!Number.isInteger(p) || p <= 0) return null
    port = p
  } else if (pcolon >= 0 && srv) {
    return null // srv URIs must not carry a port
  }
  if (!host) return null

  const params = new URLSearchParams(query)
  return {
    srv,
    host,
    port,
    user,
    password,
    database,
    authSource: params.get('authSource') ?? '',
    tls: params.get('tls') === 'true' || params.get('ssl') === 'true'
  }
}

export function buildMongoUriFromFields(f: MongoUriFields): string {
  const scheme = f.srv ? 'mongodb+srv' : 'mongodb'
  const cred = f.user
    ? `${encodeURIComponent(f.user)}${f.password ? `:${encodeURIComponent(f.password)}` : ''}@`
    : ''
  const hostPort = f.srv || f.port == null ? f.host : `${f.host}:${f.port}`
  const opts: string[] = []
  if (f.authSource) opts.push(`authSource=${encodeURIComponent(f.authSource)}`)
  if (f.tls) opts.push('tls=true')
  const query = opts.length ? `?${opts.join('&')}` : ''
  return `${scheme}://${cred}${hostPort}/${encodeURIComponent(f.database)}${query}`
}

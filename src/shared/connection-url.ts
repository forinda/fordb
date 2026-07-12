import type { PostgresProfile } from './adapter/types'

export interface ParsedConnection {
  profile: Partial<PostgresProfile>
  password?: string
  extraParams: Record<string, string>
}

const SCHEMES = new Set(['postgres:', 'postgresql:'])

export function parseConnectionUrl(input: string): ParsedConnection {
  const url = new URL(input.trim())
  if (!SCHEMES.has(url.protocol)) {
    throw new Error(`Unsupported scheme "${url.protocol}"; expected a postgres:// URL`)
  }
  const profile: Partial<PostgresProfile> = {
    engine: 'postgres',
    host: url.hostname || 'localhost',
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || undefined,
    user: url.username ? decodeURIComponent(url.username) : undefined
  }
  const password = url.password ? decodeURIComponent(url.password) : undefined

  const extraParams: Record<string, string> = {}
  for (const [key, value] of url.searchParams) {
    if (key === 'sslmode') {
      // disable → no SSL at all (leave profile.ssl unset); require/prefer/allow →
      // encrypt without verifying; verify-ca/verify-full → verify the server cert.
      if (value === 'disable') {
        continue
      }
      profile.ssl = { rejectUnauthorized: value === 'verify-ca' || value === 'verify-full' }
      continue
    }
    extraParams[key] = value
  }
  return { profile, password, extraParams }
}

export interface PgUriFields {
  host: string
  port?: number
  database?: string
  user?: string
  password?: string
  ssl?: { rejectUnauthorized: boolean }
  extraParams?: Record<string, string>
}

/** Reverse of parseConnectionUrl: build a postgres:// URI from discrete fields.
 *  Used to keep the connection-URL field two-way-synced with the form (the URI
 *  is a UI view — only the discrete fields + password persist). */
export function buildPostgresUri(f: PgUriFields): string {
  const enc = encodeURIComponent
  const auth = f.user ? `${enc(f.user)}${f.password ? `:${enc(f.password)}` : ''}@` : ''
  const port = f.port ? `:${f.port}` : ''
  const db = f.database ? `/${enc(f.database)}` : ''
  const params = new URLSearchParams()
  if (f.ssl) params.set('sslmode', f.ssl.rejectUnauthorized ? 'verify-full' : 'require')
  for (const [k, v] of Object.entries(f.extraParams ?? {})) params.set(k, v)
  const qs = params.toString() ? `?${params.toString()}` : ''
  return `postgresql://${auth}${f.host}${port}${db}${qs}`
}

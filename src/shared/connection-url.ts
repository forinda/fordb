import type { ConnectionProfile } from './adapter/types'

export interface ParsedConnection {
  profile: Partial<ConnectionProfile>
  password?: string
  extraParams: Record<string, string>
}

const SCHEMES = new Set(['postgres:', 'postgresql:'])

export function parseConnectionUrl(input: string): ParsedConnection {
  const url = new URL(input.trim())
  if (!SCHEMES.has(url.protocol)) {
    throw new Error(`Unsupported scheme "${url.protocol}"; expected a postgres:// URL`)
  }
  const profile: Partial<ConnectionProfile> = {
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

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
      // require/prefer/allow → encrypt but don't verify; verify-ca/verify-full → verify
      const verify = value === 'verify-ca' || value === 'verify-full'
      profile.ssl = { rejectUnauthorized: verify }
      continue
    }
    extraParams[key] = value
  }
  return { profile, password, extraParams }
}

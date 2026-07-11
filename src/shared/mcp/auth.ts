export interface McpConfig {
  enabled: boolean
  port: number
  token: string
}

/** True only when the header is exactly `Bearer <expected>`. */
export function checkBearer(expected: string, authHeader: string | undefined): boolean {
  if (!authHeader || !expected) return false
  const prefix = 'Bearer '
  if (!authHeader.startsWith(prefix)) return false
  return authHeader.slice(prefix.length) === expected
}

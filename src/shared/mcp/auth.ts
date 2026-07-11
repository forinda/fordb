export interface McpConfig {
  enabled: boolean
  port: number
  token: string
}

/** Constant-time string compare (equal length assumed non-secret). Avoids the
 *  early-return timing leak of `===` when comparing a bearer token. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** True only when the header is exactly `Bearer <expected>` (constant-time). */
export function checkBearer(expected: string, authHeader: string | undefined): boolean {
  if (!authHeader || !expected) return false
  const prefix = 'Bearer '
  if (!authHeader.startsWith(prefix)) return false
  return constantTimeEqual(authHeader.slice(prefix.length), expected)
}

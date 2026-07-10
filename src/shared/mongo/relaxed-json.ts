/** Parse relaxed JSON (unquoted keys, $-operators, trailing commas tolerated)
 *  into a plain JS value. Uses JSON5-style leniency via Function-free parsing:
 *  we quote bare keys then JSON.parse. Pure; no engine access. */
export function parseRelaxed(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '') return {}
  // Quote bare identifier keys ({ total: … } and { $gt: … }) → valid JSON.
  const quoted = trimmed.replace(
    /([{,]\s*)([$A-Za-z_][\w$]*)(\s*:)/g,
    (_m, pre, key, post) => `${pre}"${key}"${post}`
  )
  return JSON.parse(quoted)
}

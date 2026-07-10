import JSON5 from 'json5'

/** Parse relaxed JSON (unquoted keys, $-operators, trailing commas, comments)
 *  into a plain JS value. Respects string boundaries. Pure; no engine access. */
export function parseRelaxed(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '') return {}
  return JSON5.parse(trimmed)
}

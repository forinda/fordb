import { ObjectId } from 'mongodb'

/** Convert a BSON-bearing value to a JSON-safe representation for the renderer.
 *  ObjectId → {$oid}, Date → {$date}; arrays/objects recurse; scalars pass. */
export function toJsonSafe(value: unknown): unknown {
  if (value == null) return value
  if (value instanceof ObjectId) return { $oid: value.toHexString() }
  if (value instanceof Date) return { $date: value.toISOString() }
  if (Array.isArray(value)) return value.map(toJsonSafe)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toJsonSafe(v)
    return out
  }
  return value
}

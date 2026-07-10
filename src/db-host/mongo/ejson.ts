import { ObjectId, Decimal128, Long, Binary, UUID, Timestamp, BSONRegExp } from 'mongodb'

/** Convert a BSON-bearing value to a JSON-safe representation for the renderer.
 *  ObjectId → {$oid}, Date → {$date}, Decimal128 → {$numberDecimal},
 *  Long → {$numberLong}, Binary/UUID → {$binary}, Timestamp → {$timestamp},
 *  RegExp (JS or BSONRegExp) → {$regex,$options}; arrays/objects recurse; scalars pass.
 *
 *  Note: both UUID/Binary and Timestamp/Long are subclass pairs in the bson
 *  library, so the more specific check (UUID, Timestamp) must come first —
 *  otherwise they'd fall into the parent branch (Binary, Long) and lose their
 *  more useful string form. */
export function toJsonSafe(value: unknown): unknown {
  if (value == null) return value
  if (value instanceof ObjectId) return { $oid: value.toHexString() }
  if (value instanceof Date) return { $date: value.toISOString() }
  if (value instanceof Decimal128) return { $numberDecimal: value.toString() }
  if (value instanceof Timestamp) return { $timestamp: value.toString() }
  if (value instanceof Long) return { $numberLong: value.toString() }
  if (value instanceof UUID) return { $binary: value.toString() }
  if (value instanceof Binary) return { $binary: value.toString('base64') }
  if (value instanceof BSONRegExp) return { $regex: value.pattern, $options: value.options }
  if (value instanceof RegExp) return { $regex: value.source, $options: value.flags }
  if (Array.isArray(value)) return value.map(toJsonSafe)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toJsonSafe(v)
    return out
  }
  return value
}

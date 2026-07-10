/** Build a $set patch: top-level fields in `edited` that differ from
 *  `original` (added or changed). `_id` is never included (immutable). Pure. */
export function diffSet(
  original: Record<string, unknown>,
  edited: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(edited)) {
    if (k === '_id') continue
    if (JSON.stringify(v) !== JSON.stringify(original[k])) patch[k] = v
  }
  return patch
}

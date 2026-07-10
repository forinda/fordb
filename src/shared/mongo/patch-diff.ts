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

/** The $set patch to send for a document edit, or `null` when there's
 *  nothing to update. An empty `$set` is a silent no-op on the server, so the
 *  caller (the document Edit UI) should short-circuit on `null` instead of
 *  issuing the update. Pure — no engine access. */
export function buildUpdatePatch(
  original: Record<string, unknown>,
  edited: Record<string, unknown>
): Record<string, unknown> | null {
  const patch = diffSet(original, edited)
  return Object.keys(patch).length === 0 ? null : patch
}

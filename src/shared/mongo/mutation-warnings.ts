/** Builds the user-facing warning for a document mutation that matched zero
 *  documents on the server (`{matched:0}`/`{deleted:0}`). This happens when the
 *  `_id` is an exotic BSON type `toId()` doesn't coerce (Long/Decimal128/
 *  Binary/UUID/Timestamp), or the document was concurrently changed/deleted.
 *  Pure — the caller decides whether/where to surface it. */
export function noMatchWarning(docId: unknown): string {
  return (
    `No document matched _id ${JSON.stringify(docId)} — it may use an unsupported id type ` +
    `or was changed concurrently.`
  )
}

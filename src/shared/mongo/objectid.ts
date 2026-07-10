/** Client-side ObjectId generation for the insert form (Compass seeds a fresh
 *  _id so the user sees/controls it before insert). A 24-hex ObjectId: 4-byte
 *  seconds timestamp + 8 random bytes. Not globally-monotonic like the server
 *  counter, but a valid, unique-enough _id; the driver would accept it as-is. */
export function newObjectIdHex(now: number = Date.now(), rand: () => number = Math.random): string {
  const ts = Math.floor(now / 1000)
    .toString(16)
    .padStart(8, '0')
    .slice(-8)
  let tail = ''
  while (tail.length < 16) {
    tail += Math.floor(rand() * 0x10000)
      .toString(16)
      .padStart(4, '0')
  }
  return ts + tail.slice(0, 16)
}

/** JSON text seeding a new insert with a fresh {$oid} _id (Compass style). */
export function seedInsertJson(hex: string = newObjectIdHex()): string {
  return JSON.stringify({ _id: { $oid: hex } }, null, 2)
}

/** JSON text to clone a document: same fields, a FRESH _id (never reuse the
 *  source _id — that would collide on insert). */
export function cloneDocJson(doc: Record<string, unknown>, hex: string = newObjectIdHex()): string {
  return JSON.stringify({ ...doc, _id: { $oid: hex } }, null, 2)
}

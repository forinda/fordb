import { describe, it, expect } from 'vitest'
import { createClient } from '@libsql/client'

// Driver spike proof: @libsql/client loads and runs under vitest (Node). It
// ships N-API prebuilt binaries (ABI-stable), so the same install also loads in
// the Electron db-host with no rebuild — unlike better-sqlite3, whose Node/
// Electron ABI split would force a test↔app rebuild toggle.
describe('@libsql/client loads under Node (vitest)', () => {
  it('opens an in-memory db and runs a query', async () => {
    const db = createClient({ url: ':memory:' })
    const r = await db.execute('SELECT 1 AS one')
    expect(r.rows[0]?.one).toBe(1)
    expect(r.columns).toEqual(['one'])
    db.close()
  })
})

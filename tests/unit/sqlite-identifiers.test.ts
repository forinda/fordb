import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteAdapter } from '../../src/db-host/sqlite/sqlite-adapter'
import type { SqliteProfile } from '../../src/shared/adapter/types'

// Regression: object names from an untrusted .sqlite file may contain a double
// quote. The adapter interpolates identifiers into PRAGMA/sqlite_master
// strings, so it must escape them (double the quote) — otherwise introspecting
// such a table produces malformed SQL. A table named  weird"name  exercises it.
describe('SqliteAdapter escapes quoted identifiers', () => {
  const adapter = new SqliteAdapter()
  const profile: SqliteProfile = { id: 'q', name: 'q', engine: 'sqlite', kind: 'local', file: '' }

  beforeAll(async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'fordb-sqlite-idq-')), 'q.sqlite')
    const db = createClient({ url: `file:${file}` })
    await db.executeMultiple('CREATE TABLE "weird""name" (id INTEGER PRIMARY KEY, val TEXT)')
    db.close()
    profile.file = file
    await adapter.connect(profile)
  })
  afterAll(async () => {
    await adapter.disconnect()
  })

  it('lists a table whose name contains a double quote', async () => {
    const names = (await adapter.listTables('main')).map((t) => t.name)
    expect(names).toContain('weird"name')
  })

  it('introspects columns/keys/indexes of that table without malformed SQL', async () => {
    const cols = await adapter.getColumns('main', 'weird"name')
    expect(cols.map((c) => c.name)).toEqual(['id', 'val'])
    const keys = await adapter.getKeys('main', 'weird"name')
    expect(keys.some((k) => k.kind === 'primary' && k.columns.includes('id'))).toBe(true)
    await expect(adapter.getIndexes('main', 'weird"name')).resolves.toBeInstanceOf(Array)
  })
})

import { describe, it, expect } from 'vitest'
import { configFor } from '../../src/db-host/sqlite/sqlite-config'
import { SqliteAdapter } from '../../src/db-host/sqlite/sqlite-adapter'
import type { SqliteProfile } from '../../src/shared/adapter/types'

const base = { id: 'x', name: 'x', engine: 'sqlite' as const }

describe('configFor', () => {
  it('local → file: url, no token', () => {
    const p: SqliteProfile = { ...base, kind: 'local', file: '/tmp/a.db' }
    expect(configFor(p)).toEqual({ url: 'file:/tmp/a.db' })
  })
  it('remote → url + authToken', () => {
    const p: SqliteProfile = { ...base, kind: 'remote', url: 'libsql://x', authToken: 't' }
    expect(configFor(p)).toEqual({ url: 'libsql://x', authToken: 't' })
  })
  it('replica → file url + syncUrl + authToken', () => {
    const p: SqliteProfile = {
      ...base,
      kind: 'replica',
      file: '/tmp/r.db',
      syncUrl: 'libsql://x',
      authToken: 't'
    }
    expect(configFor(p)).toEqual({ url: 'file:/tmp/r.db', syncUrl: 'libsql://x', authToken: 't' })
  })
})

describe('SqliteAdapter.connect wiring', () => {
  function fakeClient(): {
    calls: string[]
    execute: () => Promise<unknown>
    sync: () => void
    close: () => void
  } {
    const self = {
      calls: [] as string[],
      execute: async () => ({ rows: [], columns: [], rowsAffected: 0 }),
      sync: () => self.calls.push('sync'),
      close: () => self.calls.push('close')
    }
    return self
  }

  it('passes remote config and does NOT sync', async () => {
    const seen: unknown[] = []
    const fc = fakeClient()
    const adapter = new SqliteAdapter(((c: unknown) => (seen.push(c), fc)) as never)
    await adapter.connect({
      ...base,
      kind: 'remote',
      url: 'libsql://x',
      authToken: 't'
    } as SqliteProfile)
    expect(seen[0]).toEqual({ url: 'libsql://x', authToken: 't' })
    expect(fc.calls).not.toContain('sync')
  })

  it('syncs on connect for a replica', async () => {
    const fc = fakeClient()
    const adapter = new SqliteAdapter((() => fc) as never)
    await adapter.connect({
      ...base,
      kind: 'replica',
      file: '/tmp/r.db',
      syncUrl: 'libsql://x'
    } as SqliteProfile)
    expect(fc.calls).toContain('sync')
  })
})

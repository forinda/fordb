import { describe, it, expect } from 'vitest'
import { configFor } from '../../src/db-host/sqlite/sqlite-config'
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

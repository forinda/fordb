import { describe, it, expect } from 'vitest'
import { connectionLabel } from '../../src/shared/connection-label'
import type { ConnectionProfile } from '../../src/shared/adapter/types'

function profile(over: Partial<ConnectionProfile>): ConnectionProfile {
  return {
    id: 'p1',
    name: '',
    engine: 'postgres',
    host: 'localhost',
    port: 5432,
    database: '',
    user: '',
    ...over
  }
}

describe('connectionLabel', () => {
  it('uses the name when present', () => {
    expect(connectionLabel(profile({ name: 'Prod DB' }))).toBe('Prod DB')
  })
  it('trims and ignores whitespace-only names', () => {
    expect(connectionLabel(profile({ name: '   ', host: 'h', database: 'd', user: 'u' }))).toBe(
      'u@h/d'
    )
  })
  it('falls back to user@host/database when name is empty', () => {
    expect(
      connectionLabel(
        profile({ name: '', host: 'db.example.com', user: 'alice', database: 'shop' })
      )
    ).toBe('alice@db.example.com/shop')
  })
  it('omits missing user and database gracefully', () => {
    expect(connectionLabel(profile({ name: '', host: 'localhost', user: '', database: '' }))).toBe(
      'localhost'
    )
  })
  it('host + database without user', () => {
    expect(connectionLabel(profile({ name: '', host: 'h', database: 'd', user: '' }))).toBe('h/d')
  })
  it('returns a placeholder when everything is blank', () => {
    expect(connectionLabel(profile({ name: '', host: '', database: '', user: '' }))).toBe(
      'Unnamed connection'
    )
  })
})

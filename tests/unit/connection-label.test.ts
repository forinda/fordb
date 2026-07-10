import { describe, it, expect } from 'vitest'
import { connectionLabel } from '../../src/shared/connection-label'
import type { PostgresProfile, MongoProfile } from '../../src/shared/adapter/types'

function profile(over: Partial<PostgresProfile>): PostgresProfile {
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
  it('falls back to the file basename (sqlite local)', () => {
    expect(
      connectionLabel({
        id: 's1',
        name: '',
        engine: 'sqlite',
        kind: 'local',
        file: '/tmp/app.sqlite'
      })
    ).toBe('app.sqlite')
  })
  it('uses the name when set (sqlite local)', () => {
    expect(
      connectionLabel({
        id: 's1',
        name: 'Local',
        engine: 'sqlite',
        kind: 'local',
        file: '/tmp/app.sqlite'
      })
    ).toBe('Local')
  })
  it('sqlite remote falls back to the url', () => {
    expect(
      connectionLabel({
        id: 'r',
        name: '',
        engine: 'sqlite',
        kind: 'remote',
        url: 'libsql://x.turso.io'
      })
    ).toBe('libsql://x.turso.io')
  })
  it('sqlite replica falls back to the file basename', () => {
    expect(
      connectionLabel({
        id: 'r',
        name: '',
        engine: 'sqlite',
        kind: 'replica',
        file: '/tmp/rep.sqlite',
        syncUrl: 'libsql://x'
      })
    ).toBe('rep.sqlite')
  })

  describe('mongodb', () => {
    it('discrete host + user + database', () => {
      expect(
        connectionLabel({
          id: 'm',
          name: '',
          engine: 'mongodb',
          host: 'localhost',
          user: 'admin',
          database: 'app'
        } as MongoProfile)
      ).toBe('admin@localhost/app')
    })
    it('host + database, no user', () => {
      expect(
        connectionLabel({
          id: 'm',
          name: '',
          engine: 'mongodb',
          host: 'localhost',
          database: 'app'
        } as MongoProfile)
      ).toBe('localhost/app')
    })
    it('host only', () => {
      expect(
        connectionLabel({
          id: 'm',
          name: '',
          engine: 'mongodb',
          host: 'localhost'
        } as MongoProfile)
      ).toBe('localhost')
    })
    it('uri only (no host/user/database)', () => {
      expect(
        connectionLabel({
          id: 'm',
          name: '',
          engine: 'mongodb',
          uri: 'mongodb+srv://c.example.net/'
        } as MongoProfile)
      ).toBe('mongodb+srv://c.example.net/')
    })
    it('nothing set returns Unnamed connection', () => {
      expect(
        connectionLabel({
          id: 'm',
          name: '',
          engine: 'mongodb'
        } as MongoProfile)
      ).toBe('Unnamed connection')
    })
  })
})

import { describe, it, expect } from 'vitest'
import { buildMongoUri } from '../../src/db-host/mongo/mongo-config'
import type { MongoProfile } from '../../src/shared/adapter/types'

const base = { id: 'm', name: 'm', engine: 'mongodb' as const }

describe('buildMongoUri', () => {
  it('uses an explicit uri verbatim', () => {
    const p: MongoProfile = { ...base, uri: 'mongodb+srv://u:p@c.example.net/?retryWrites=true' }
    expect(buildMongoUri(p)).toBe('mongodb+srv://u:p@c.example.net/?retryWrites=true')
  })
  it('assembles from discrete fields with auth + options', () => {
    const p: MongoProfile = {
      ...base,
      host: 'localhost',
      port: 27017,
      user: 'admin',
      password: 'secret',
      authSource: 'admin',
      tls: true
    }
    expect(buildMongoUri(p)).toBe(
      'mongodb://admin:secret@localhost:27017/?authSource=admin&tls=true'
    )
  })
  it('assembles a hostonly uri with default port', () => {
    const p: MongoProfile = { ...base, host: 'db.local' }
    expect(buildMongoUri(p)).toBe('mongodb://db.local:27017/')
  })
  it('percent-encodes credentials', () => {
    const p: MongoProfile = { ...base, host: 'h', user: 'a@b', password: 'p:/@' }
    expect(buildMongoUri(p)).toBe('mongodb://a%40b:p%3A%2F%40@h:27017/')
  })
  it('throws when neither uri nor host is set', () => {
    expect(() => buildMongoUri({ ...base })).toThrow(/uri or host/i)
  })
})

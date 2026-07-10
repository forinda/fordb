import { describe, it, expect } from 'vitest'
import {
  parseMongoUri,
  buildMongoUriFromFields,
  type MongoUriFields
} from '../../src/shared/mongo/uri'

describe('parseMongoUri', () => {
  it('parses a full standard URI', () => {
    expect(
      parseMongoUri('mongodb://admin:s3cr%40t@db.acme.io:27018/app?authSource=admin&tls=true')
    ).toEqual({
      srv: false,
      host: 'db.acme.io',
      port: 27018,
      user: 'admin',
      password: 's3cr@t',
      database: 'app',
      authSource: 'admin',
      tls: true
    })
  })
  it('parses a bare localhost URI with defaults', () => {
    expect(parseMongoUri('mongodb://localhost:27017/')).toEqual({
      srv: false,
      host: 'localhost',
      port: 27017,
      user: '',
      password: '',
      database: '',
      authSource: '',
      tls: false
    })
  })
  it('parses mongodb+srv (no port)', () => {
    const f = parseMongoUri('mongodb+srv://u:p@cluster0.abc.mongodb.net/mydb')
    expect(f?.srv).toBe(true)
    expect(f?.host).toBe('cluster0.abc.mongodb.net')
    expect(f?.port).toBeNull()
    expect(f?.database).toBe('mydb')
  })
  it('returns null on a non-mongo or malformed string', () => {
    expect(parseMongoUri('postgres://x')).toBeNull()
    expect(parseMongoUri('mongodb://')).toBeNull()
    expect(parseMongoUri('not a uri')).toBeNull()
  })
})

describe('buildMongoUriFromFields', () => {
  it('round-trips the parse', () => {
    const uri = 'mongodb://admin:pw@h:27018/app?authSource=admin&tls=true'
    const fields = parseMongoUri(uri)!
    expect(parseMongoUri(buildMongoUriFromFields(fields))).toEqual(fields)
  })
  it('omits empty credentials and options', () => {
    const f: MongoUriFields = {
      srv: false,
      host: 'localhost',
      port: 27017,
      user: '',
      password: '',
      database: '',
      authSource: '',
      tls: false
    }
    expect(buildMongoUriFromFields(f)).toBe('mongodb://localhost:27017/')
  })
  it('builds srv without a port', () => {
    const f: MongoUriFields = {
      srv: true,
      host: 'c0.abc.mongodb.net',
      port: null,
      user: 'u',
      password: 'p',
      database: 'db',
      authSource: '',
      tls: false
    }
    expect(buildMongoUriFromFields(f)).toBe('mongodb+srv://u:p@c0.abc.mongodb.net/db')
  })
})

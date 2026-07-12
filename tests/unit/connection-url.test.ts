import { describe, it, expect } from 'vitest'
import { parseConnectionUrl, buildPostgresUri } from '../../src/shared/connection-url'

describe('parseConnectionUrl', () => {
  it('parses a full postgres URL', () => {
    const r = parseConnectionUrl(
      'postgres://alice:s3cret@db.example.com:6543/shop?application_name=fordb'
    )
    expect(r.profile.engine).toBe('postgres')
    expect(r.profile.host).toBe('db.example.com')
    expect(r.profile.port).toBe(6543)
    expect(r.profile.database).toBe('shop')
    expect(r.profile.user).toBe('alice')
    expect(r.password).toBe('s3cret')
    expect(r.extraParams).toEqual({ application_name: 'fordb' })
  })
  it('accepts the postgresql:// scheme and defaults port 5432', () => {
    const r = parseConnectionUrl('postgresql://bob@localhost/mydb')
    expect(r.profile.port).toBe(5432)
    expect(r.profile.user).toBe('bob')
    expect(r.password).toBeUndefined()
    expect(r.profile.database).toBe('mydb')
  })
  it('maps sslmode to ssl (require/verify-full → ssl on)', () => {
    const r = parseConnectionUrl('postgres://u@h/d?sslmode=require')
    expect(r.profile.ssl?.rejectUnauthorized).toBe(false) // require = encrypt, do not verify CA
    const r2 = parseConnectionUrl('postgres://u@h/d?sslmode=verify-full')
    expect(r2.profile.ssl?.rejectUnauthorized).toBe(true)
    expect(r.extraParams.sslmode).toBeUndefined() // consumed, not left in extras
  })
  it('sslmode=disable leaves ssl unset (does not turn SSL on)', () => {
    const r = parseConnectionUrl('postgres://u@h/d?sslmode=disable')
    expect(r.profile.ssl).toBeUndefined()
    expect(r.extraParams.sslmode).toBeUndefined() // still consumed
  })
  it('percent-decodes credentials', () => {
    const r = parseConnectionUrl('postgres://a%40b:p%3Aw@h/d')
    expect(r.profile.user).toBe('a@b')
    expect(r.password).toBe('p:w')
  })
  it('throws on an unsupported scheme', () => {
    expect(() => parseConnectionUrl('mysql://u@h/d')).toThrow(/unsupported|scheme|postgres/i)
  })
  it('throws on unparseable input', () => {
    expect(() => parseConnectionUrl('not a url')).toThrow()
  })
})

describe('buildPostgresUri', () => {
  it('builds a full URI with credentials + db', () => {
    expect(
      buildPostgresUri({ host: 'db.x', port: 5433, database: 'app', user: 'u', password: 'p' })
    ).toBe('postgresql://u:p@db.x:5433/app')
  })
  it('omits auth when no user, omits port when absent', () => {
    expect(buildPostgresUri({ host: 'localhost', database: 'app' })).toBe(
      'postgresql://localhost/app'
    )
  })
  it('percent-encodes special chars in credentials + db', () => {
    expect(
      buildPostgresUri({ host: 'h', user: 'a b', password: 'p@ss/w', database: 'my db' })
    ).toBe('postgresql://a%20b:p%40ss%2Fw@h/my%20db')
  })
  it('emits sslmode from the ssl flag', () => {
    expect(buildPostgresUri({ host: 'h', ssl: { rejectUnauthorized: true } })).toBe(
      'postgresql://h?sslmode=verify-full'
    )
    expect(buildPostgresUri({ host: 'h', ssl: { rejectUnauthorized: false } })).toBe(
      'postgresql://h?sslmode=require'
    )
  })
  it('round-trips through parseConnectionUrl', () => {
    const uri = buildPostgresUri({
      host: 'db.x',
      port: 5432,
      database: 'app',
      user: 'u',
      password: 'p@w'
    })
    const p = parseConnectionUrl(uri)
    expect(p.profile.host).toBe('db.x')
    expect(p.profile.port).toBe(5432)
    expect(p.profile.database).toBe('app')
    expect(p.profile.user).toBe('u')
    expect(p.password).toBe('p@w')
  })
})

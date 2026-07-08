import { describe, it, expect } from 'vitest'
import { parseConnectionUrl } from '../../src/shared/connection-url'

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

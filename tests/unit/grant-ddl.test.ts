import { describe, it, expect } from 'vitest'
import { buildGrant, buildRevoke, TABLE_PRIVILEGES } from '../../src/shared/ddl/grant-ddl'

describe('buildGrant', () => {
  it('grants a privilege set on a qualified table to a role', () => {
    expect(buildGrant(['SELECT', 'INSERT'], 'app', 'users', 'reader')).toBe(
      `GRANT SELECT, INSERT ON "app"."users" TO "reader"`
    )
  })
  it('orders privileges stably and de-duplicates', () => {
    expect(buildGrant(['insert', 'select', 'select'], 'app', 't', 'r')).toBe(
      `GRANT SELECT, INSERT ON "app"."t" TO "r"`
    )
  })
  it('collapses to ALL when ALL is present', () => {
    expect(buildGrant(['ALL'], 'app', 't', 'r')).toBe(`GRANT ALL ON "app"."t" TO "r"`)
  })
  it('appends WITH GRANT OPTION', () => {
    expect(buildGrant(['SELECT'], 'app', 't', 'r', true)).toBe(
      `GRANT SELECT ON "app"."t" TO "r" WITH GRANT OPTION`
    )
  })
  it('quotes identifiers with embedded quotes', () => {
    expect(buildGrant(['SELECT'], 'a"b', 't"x', 'r"y')).toBe(
      `GRANT SELECT ON "a""b"."t""x" TO "r""y"`
    )
  })
})

describe('buildRevoke', () => {
  it('revokes a privilege on a qualified table from a role', () => {
    expect(buildRevoke(['DELETE'], 'app', 'users', 'reader')).toBe(
      `REVOKE DELETE ON "app"."users" FROM "reader"`
    )
  })
  it('revokes ALL', () => {
    expect(buildRevoke(['all'], 'app', 't', 'r')).toBe(`REVOKE ALL ON "app"."t" FROM "r"`)
  })
})

describe('TABLE_PRIVILEGES', () => {
  it('covers the standard table privileges', () => {
    expect(TABLE_PRIVILEGES).toContain('SELECT')
    expect(TABLE_PRIVILEGES).toContain('TRUNCATE')
    expect(TABLE_PRIVILEGES).toContain('TRIGGER')
  })
})

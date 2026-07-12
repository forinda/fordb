import { describe, it, expect } from 'vitest'
import {
  buildCreateRole,
  buildAlterRole,
  buildDropRole,
  membershipChanges,
  maskRolePassword,
  type RoleAttrs
} from '../../src/shared/ddl/role-ddl'

const attrs = (over: Partial<RoleAttrs> = {}): RoleAttrs => ({
  login: false,
  superuser: false,
  createDb: false,
  createRole: false,
  replication: false,
  ...over
})

describe('buildCreateRole', () => {
  it('emits every attribute explicitly, identifier quoted', () => {
    expect(buildCreateRole('app_user', attrs({ login: true, createDb: true }))).toBe(
      `CREATE ROLE "app_user" WITH LOGIN NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION`
    )
  })
  it('adds a quoted, escaped password when given', () => {
    expect(buildCreateRole('u', attrs({ login: true }), "p'w")).toBe(
      `CREATE ROLE "u" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD 'p''w'`
    )
  })
})

describe('buildAlterRole', () => {
  it('uses ALTER ROLE with the same attribute clause', () => {
    expect(buildAlterRole('u', attrs({ superuser: true }))).toBe(
      `ALTER ROLE "u" WITH NOLOGIN SUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`
    )
  })
  it('only sets the password when provided (empty = unchanged)', () => {
    expect(buildAlterRole('u', attrs(), '')).not.toContain('PASSWORD')
    expect(buildAlterRole('u', attrs(), 'x')).toContain(`PASSWORD 'x'`)
  })
})

describe('buildDropRole', () => {
  it('quotes the name', () => {
    expect(buildDropRole('app_user')).toBe(`DROP ROLE "app_user"`)
  })
})

describe('membershipChanges', () => {
  it('grants added parents, revokes removed ones', () => {
    expect(membershipChanges('u', ['a', 'b'], ['b', 'c'])).toEqual([
      `REVOKE "a" FROM "u"`,
      `GRANT "c" TO "u"`
    ])
  })
  it('no change → no statements', () => {
    expect(membershipChanges('u', ['a'], ['a'])).toEqual([])
  })
})

describe('maskRolePassword', () => {
  it('masks the password literal for display', () => {
    expect(maskRolePassword(`CREATE ROLE "u" WITH LOGIN PASSWORD 'secret'`)).toBe(
      `CREATE ROLE "u" WITH LOGIN PASSWORD '****'`
    )
  })
  it('masks an escaped password', () => {
    expect(maskRolePassword(`ALTER ROLE "u" WITH NOLOGIN PASSWORD 'a''b'`)).toBe(
      `ALTER ROLE "u" WITH NOLOGIN PASSWORD '****'`
    )
  })
  it('leaves passwordless SQL untouched', () => {
    expect(maskRolePassword(`DROP ROLE "u"`)).toBe(`DROP ROLE "u"`)
  })
})

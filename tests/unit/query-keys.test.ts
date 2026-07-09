import { describe, it, expect } from 'vitest'
import { qk } from '../../src/renderer/src/query/keys'

describe('query key factory', () => {
  it('profiles key is stable and flat', () => {
    expect(qk.profiles()).toEqual(['profiles'])
  })
  it('connection-scoped keys are prefixed with conn+id', () => {
    expect(qk.schemas('c1')).toEqual(['conn', 'c1', 'schemas'])
    expect(qk.tables('c1', 'app')).toEqual(['conn', 'c1', 'tables', 'app'])
    expect(qk.columns('c1', 'app', 'users')).toEqual(['conn', 'c1', 'columns', 'app', 'users'])
  })
  it("['conn', id] is a prefix of every scoped key for that id only", () => {
    const keys = [qk.schemas('A'), qk.tables('A', 's'), qk.columns('A', 's', 't')]
    for (const k of keys) {
      expect(k.slice(0, 2)).toEqual(['conn', 'A'])
    }
    expect(qk.schemas('B').slice(0, 2)).not.toEqual(['conn', 'A'])
  })
  it('stats keys are conn-scoped', () => {
    expect(qk.serverSnapshot('c1')).toEqual(['conn', 'c1', 'serverSnapshot'])
    expect(qk.sessions('c1')).toEqual(['conn', 'c1', 'sessions'])
    expect(qk.locks('c1')).toEqual(['conn', 'c1', 'locks'])
  })
})

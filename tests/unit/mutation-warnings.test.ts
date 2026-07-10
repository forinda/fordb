import { describe, it, expect } from 'vitest'
import { noMatchWarning } from '../../src/shared/mongo/mutation-warnings'

describe('noMatchWarning', () => {
  it('mentions the _id and the two likely causes', () => {
    const msg = noMatchWarning('abc123')
    expect(msg).toContain('"abc123"')
    expect(msg).toMatch(/unsupported id type/)
    expect(msg).toMatch(/concurrently/)
  })

  it('JSON-stringifies non-scalar ids (e.g. exotic BSON EJSON shapes)', () => {
    const msg = noMatchWarning({ $numberLong: '123' })
    expect(msg).toContain('{"$numberLong":"123"}')
  })
})

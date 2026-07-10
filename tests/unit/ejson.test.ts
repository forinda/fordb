import { describe, it, expect } from 'vitest'
import { ObjectId } from 'mongodb'
import { toJsonSafe } from '../../src/db-host/mongo/ejson'
import { parseRelaxed } from '../../src/shared/mongo/relaxed-json'

describe('toJsonSafe', () => {
  it('renders ObjectId as { $oid }', () => {
    const id = new ObjectId('64b7e12000000000000000ab')
    expect(toJsonSafe({ _id: id })).toEqual({ _id: { $oid: '64b7e12000000000000000ab' } })
  })
  it('renders Date as { $date } ISO', () => {
    const d = new Date('2026-07-10T00:00:00.000Z')
    expect(toJsonSafe({ at: d })).toEqual({ at: { $date: '2026-07-10T00:00:00.000Z' } })
  })
  it('recurses arrays and nested docs, passes scalars through', () => {
    expect(toJsonSafe({ a: [1, 'x', { b: true }], n: null })).toEqual({
      a: [1, 'x', { b: true }],
      n: null
    })
  })
})

describe('parseRelaxed', () => {
  it('parses strict JSON', () => {
    expect(parseRelaxed('{ "status": "open" }')).toEqual({ status: 'open' })
  })
  it('accepts unquoted keys and $-operators', () => {
    expect(parseRelaxed('{ total: { $gt: 100 } }')).toEqual({ total: { $gt: 100 } })
  })
  it('parses a pipeline array', () => {
    expect(parseRelaxed('[ { $match: { a: 1 } } ]')).toEqual([{ $match: { a: 1 } }])
  })
  it('throws a readable error on malformed input', () => {
    expect(() => parseRelaxed('{ a: }')).toThrow()
  })
  it('does not corrupt string values containing commas and colons', () => {
    expect(parseRelaxed('{ note: "a, b: c" }')).toEqual({ note: 'a, b: c' })
  })
})

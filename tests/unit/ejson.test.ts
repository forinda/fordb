import { describe, it, expect } from 'vitest'
import { ObjectId, Decimal128, Long, Binary, UUID, Timestamp, BSONRegExp } from 'mongodb'
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
  it('renders Decimal128 as { $numberDecimal }', () => {
    const amount = Decimal128.fromString('12.34')
    expect(toJsonSafe({ amount })).toEqual({ amount: { $numberDecimal: '12.34' } })
  })
  it('renders Long as { $numberLong }', () => {
    const n = Long.fromNumber(9007199254740993)
    expect(toJsonSafe({ n })).toEqual({ n: { $numberLong: n.toString() } })
  })
  it('renders Binary as { $binary } base64', () => {
    const bin = new Binary(Buffer.from('hello'), 0)
    expect(toJsonSafe({ bin })).toEqual({ bin: { $binary: bin.toString('base64') } })
  })
  it('renders UUID as { $binary } with its string form (not the raw Binary buffer)', () => {
    const id = new UUID('01696ac5-0f8c-4de6-9218-9f4a08e78d69')
    expect(toJsonSafe({ id })).toEqual({ id: { $binary: '01696ac5-0f8c-4de6-9218-9f4a08e78d69' } })
  })
  it('renders Timestamp as { $timestamp }', () => {
    const ts = Timestamp.fromNumber(123)
    expect(toJsonSafe({ ts })).toEqual({ ts: { $timestamp: ts.toString() } })
  })
  it('renders a BSONRegExp as { $regex, $options }', () => {
    const re = new BSONRegExp('^a', 'i')
    expect(toJsonSafe({ re })).toEqual({ re: { $regex: '^a', $options: 'i' } })
  })
  it('renders a JS RegExp as { $regex, $options }', () => {
    expect(toJsonSafe({ re: /^a/i })).toEqual({ re: { $regex: '^a', $options: 'i' } })
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

describe('reviveEjson', () => {
  it('revives $oid to an ObjectId and $date to a Date', async () => {
    const { reviveEjson } = await import('../../src/db-host/mongo/ejson')
    const { ObjectId } = await import('mongodb')
    const out = reviveEjson({
      _id: { $oid: '64b7e12000000000000000ab' },
      at: { $date: '2026-07-10T00:00:00.000Z' },
      name: 'x',
      nested: { a: [{ $oid: '64b7e12000000000000000ac' }] }
    }) as Record<string, unknown>
    expect(out._id).toBeInstanceOf(ObjectId)
    expect((out._id as InstanceType<typeof ObjectId>).toHexString()).toBe(
      '64b7e12000000000000000ab'
    )
    expect(out.at).toBeInstanceOf(Date)
    expect(out.name).toBe('x')
    expect((out.nested as { a: unknown[] }).a[0]).toBeInstanceOf(ObjectId)
  })
})

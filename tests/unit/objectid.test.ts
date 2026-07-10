import { describe, it, expect } from 'vitest'
import { newObjectIdHex, seedInsertJson, cloneDocJson } from '../../src/shared/mongo/objectid'

describe('newObjectIdHex', () => {
  it('is 24 lowercase hex chars', () => {
    expect(newObjectIdHex()).toMatch(/^[0-9a-f]{24}$/)
  })
  it('encodes the timestamp in the leading 8 hex', () => {
    // 2026-07-10T00:00:00Z → 1783..., leading 8 hex = seconds in hex.
    const now = 1_783_000_000_000
    const hex = newObjectIdHex(now, () => 0)
    expect(hex.slice(0, 8)).toBe(Math.floor(now / 1000).toString(16))
  })
  it('varies with randomness', () => {
    let n = 0
    const seq = (): number => {
      n += 0.111
      return n % 1
    }
    expect(newObjectIdHex(1, seq)).not.toBe(newObjectIdHex(1, seq))
  })
})

describe('seedInsertJson', () => {
  it('seeds a fresh {$oid} _id', () => {
    expect(JSON.parse(seedInsertJson('64b7e12000000000000000ab'))).toEqual({
      _id: { $oid: '64b7e12000000000000000ab' }
    })
  })
})

describe('cloneDocJson', () => {
  it('keeps fields but assigns a fresh _id', () => {
    const cloned = JSON.parse(
      cloneDocJson(
        { _id: { $oid: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, name: 'x', n: 3 },
        'bbbbbbbbbbbbbbbbbbbbbbbb'
      )
    )
    expect(cloned).toEqual({ _id: { $oid: 'bbbbbbbbbbbbbbbbbbbbbbbb' }, name: 'x', n: 3 })
  })
})

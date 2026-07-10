import { describe, it, expect } from 'vitest'
import { diffSet, buildUpdatePatch } from '../../src/shared/mongo/patch-diff'

describe('diffSet', () => {
  it('returns only changed/added top-level fields, excludes _id', () => {
    expect(
      diffSet({ _id: 1, a: 1, b: 'x', c: true }, { _id: 1, a: 2, b: 'x', c: true, d: 9 })
    ).toEqual({ a: 2, d: 9 })
  })
  it('is empty when nothing changed', () => {
    expect(diffSet({ _id: 1, a: 1 }, { _id: 1, a: 1 })).toEqual({})
  })
})

describe('buildUpdatePatch', () => {
  it('returns null when nothing changed (empty-diff short-circuit)', () => {
    expect(buildUpdatePatch({ _id: 1, a: 1 }, { _id: 1, a: 1 })).toBeNull()
  })
  it('returns the patch when something changed', () => {
    expect(buildUpdatePatch({ _id: 1, a: 1 }, { _id: 1, a: 2 })).toEqual({ a: 2 })
  })
})

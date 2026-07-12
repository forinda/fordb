import { describe, it, expect } from 'vitest'
import { fkForColumn, fkFilters, type FkNav } from '../../src/shared/browse/fk-nav'

const fks: FkNav[] = [
  { columns: ['author_id'], refTable: 'users', refColumns: ['id'] },
  { columns: ['org_id', 'team_id'], refTable: 'teams', refColumns: ['org', 'id'] }
]

describe('fkForColumn', () => {
  it('finds the single-column FK covering a column', () => {
    expect(fkForColumn(fks, 'author_id')?.refTable).toBe('users')
  })
  it('finds the composite FK covering any of its columns', () => {
    expect(fkForColumn(fks, 'team_id')?.refTable).toBe('teams')
    expect(fkForColumn(fks, 'org_id')?.refTable).toBe('teams')
  })
  it('returns undefined for a non-FK column', () => {
    expect(fkForColumn(fks, 'name')).toBeUndefined()
  })
})

describe('fkFilters', () => {
  it('single-column FK → one eq filter on the referenced column', () => {
    expect(fkFilters(fks[0]!, [42])).toEqual([{ column: 'id', op: 'eq', value: 42 }])
  })
  it('composite FK → one eq filter per referenced column, aligned to values', () => {
    expect(fkFilters(fks[1]!, ['acme', 7])).toEqual([
      { column: 'org', op: 'eq', value: 'acme' },
      { column: 'id', op: 'eq', value: 7 }
    ])
  })
})

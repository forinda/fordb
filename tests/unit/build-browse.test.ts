import { describe, it, expect } from 'vitest'
import { buildBrowseSql } from '../../src/shared/browse/build-browse'
import type { BrowseOptions } from '../../src/shared/adapter/browse-types'

const opts = (over: Partial<BrowseOptions>): BrowseOptions => ({
  schema: 'app',
  table: 'users',
  filters: [],
  sort: [],
  pageSize: 1000,
  ...over
})

describe('buildBrowseSql', () => {
  it('no filters/sort → plain select', () => {
    expect(buildBrowseSql(opts({}), 'pg')).toEqual({
      sql: `SELECT * FROM "app"."users"`,
      params: []
    })
  })
  it('pg: filters bound with $n, AND-joined', () => {
    const r = buildBrowseSql(
      opts({
        filters: [
          { column: 'id', op: 'ge', value: 5 },
          { column: 'email', op: 'contains', value: 'x' },
          { column: 'name', op: 'isNull' }
        ]
      }),
      'pg'
    )
    expect(r.sql).toBe(
      `SELECT * FROM "app"."users" WHERE "id" >= $1 AND "email" LIKE $2 AND "name" IS NULL`
    )
    expect(r.params).toEqual([5, '%x%'])
  })
  it('sqlite: placeholders are ?', () => {
    const r = buildBrowseSql(opts({ filters: [{ column: 'id', op: 'eq', value: 3 }] }), 'sqlite')
    expect(r.sql).toBe(`SELECT * FROM "app"."users" WHERE "id" = ?`)
    expect(r.params).toEqual([3])
  })
  it('sort → ORDER BY, multi-column in order', () => {
    const r = buildBrowseSql(
      opts({
        sort: [
          { column: 'name', dir: 'asc' },
          { column: 'id', dir: 'desc' }
        ]
      }),
      'pg'
    )
    expect(r.sql).toBe(`SELECT * FROM "app"."users" ORDER BY "name" ASC, "id" DESC`)
  })
  it('a quote in a value stays a bound param (no injection)', () => {
    const r = buildBrowseSql(
      opts({ filters: [{ column: 'email', op: 'eq', value: "x' OR '1'='1" }] }),
      'pg'
    )
    expect(r.sql).toBe(`SELECT * FROM "app"."users" WHERE "email" = $1`)
    expect(r.params).toEqual(["x' OR '1'='1"])
  })
})

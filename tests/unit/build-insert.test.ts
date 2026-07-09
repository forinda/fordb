import { describe, it, expect } from 'vitest'
import { buildInsert } from '../../src/shared/sql/build-insert'

describe('buildInsert', () => {
  it('quotes idents, escapes values', () => {
    expect(buildInsert('app', 'users', ['id', 'name'], [1, "O'Brien"], 'pg')).toBe(
      `INSERT INTO "app"."users" ("id", "name") VALUES (1, 'O''Brien')`
    )
  })
})

import { describe, it, expect } from 'vitest'
import { isReadOnlyQuery } from '../../src/shared/sql/classify'
import { checkBearer } from '../../src/shared/mcp/auth'

describe('isReadOnlyQuery — accepts read statements', () => {
  for (const sql of [
    'SELECT 1',
    '  select * from orders where id = 1',
    'WITH x AS (SELECT 1) SELECT * FROM x',
    'EXPLAIN SELECT * FROM t',
    'VALUES (1),(2)',
    'SHOW server_version',
    'SELECT 1;', // single trailing semicolon
    '-- a comment\nSELECT 2'
  ])
    it(JSON.stringify(sql), () => expect(isReadOnlyQuery(sql)).toBe(true))
})

describe('isReadOnlyQuery — rejects writes / tricks', () => {
  for (const sql of [
    'INSERT INTO t VALUES (1)',
    'UPDATE t SET a = 1',
    'DELETE FROM t',
    'DROP TABLE t',
    'CREATE TABLE t (id int)',
    'TRUNCATE t',
    'EXPLAIN ANALYZE INSERT INTO t VALUES (1)', // ANALYZE executes
    'EXPLAIN ANALYZE SELECT 1', // ANALYZE executes the SELECT — still reject
    'WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x', // data-modifying CTE
    'SELECT 1; DROP TABLE t', // second statement
    'SELECT 1;DROP TABLE t',
    '' // empty
  ])
    it(JSON.stringify(sql), () => expect(isReadOnlyQuery(sql)).toBe(false))
})

describe('checkBearer', () => {
  it('accepts the exact token', () => {
    expect(checkBearer('abc123', 'Bearer abc123')).toBe(true)
  })
  it('rejects a wrong token', () => {
    expect(checkBearer('abc123', 'Bearer nope')).toBe(false)
  })
  it('rejects a missing header', () => {
    expect(checkBearer('abc123', undefined)).toBe(false)
  })
  it('rejects a malformed header', () => {
    expect(checkBearer('abc123', 'abc123')).toBe(false)
  })
})

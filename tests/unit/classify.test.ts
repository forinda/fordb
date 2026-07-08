import { describe, it, expect } from 'vitest'
import { isSelectLike } from '../../src/shared/sql/classify'

describe('isSelectLike', () => {
  it('true for select/with/values/explain/table/show', () => {
    for (const s of [
      'SELECT 1',
      'select * from t',
      'WITH x AS (select 1) select * from x',
      'VALUES (1)',
      'EXPLAIN SELECT 1',
      'TABLE users',
      'SHOW search_path'
    ]) {
      expect(isSelectLike(s)).toBe(true)
    }
  })
  it('false for dml/ddl', () => {
    for (const s of [
      'INSERT INTO t VALUES (1)',
      'update t set x=1',
      'DELETE FROM t',
      'CREATE TABLE t (id int)',
      'DROP TABLE t',
      'ALTER TABLE t ADD c int',
      'BEGIN'
    ]) {
      expect(isSelectLike(s)).toBe(false)
    }
  })
  it('ignores leading comments and whitespace', () => {
    expect(isSelectLike('  -- a comment\n  SELECT 1')).toBe(true)
    expect(isSelectLike('/* block */\nUPDATE t SET x=1')).toBe(false)
  })
  it('false for empty/whitespace', () => {
    expect(isSelectLike('   ')).toBe(false)
  })
})

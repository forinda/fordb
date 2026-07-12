import { describe, it, expect } from 'vitest'
import { isDestructive } from '../../src/shared/sql/classify'

describe('isDestructive', () => {
  it('flags DROP / TRUNCATE', () => {
    expect(isDestructive('DROP TABLE users')).toBe(true)
    expect(isDestructive('truncate table t')).toBe(true)
  })
  it('flags ALTER ... DROP', () => {
    expect(isDestructive('ALTER TABLE t DROP COLUMN c')).toBe(true)
  })
  it('flags DELETE / UPDATE without WHERE', () => {
    expect(isDestructive('DELETE FROM t')).toBe(true)
    expect(isDestructive('UPDATE t SET x = 1')).toBe(true)
  })
  it('allows DELETE / UPDATE with WHERE', () => {
    expect(isDestructive('DELETE FROM t WHERE id = 1')).toBe(false)
    expect(isDestructive('UPDATE t SET x = 1 WHERE id = 2')).toBe(false)
  })
  it('does not flag INSERT / ALTER ADD / CREATE', () => {
    expect(isDestructive('INSERT INTO t VALUES (1)')).toBe(false)
    expect(isDestructive('ALTER TABLE t ADD COLUMN c int')).toBe(false)
    expect(isDestructive('CREATE TABLE t (id int)')).toBe(false)
  })
  it('treats empty / unclassifiable input as destructive (conservative)', () => {
    expect(isDestructive('')).toBe(true)
  })
})

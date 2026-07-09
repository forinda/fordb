import { describe, it, expect } from 'vitest'
import { buildExplain } from '../../src/shared/sql/explain'

describe('buildExplain', () => {
  it('pg: EXPLAIN / EXPLAIN ANALYZE, trailing ; trimmed', () => {
    expect(buildExplain('SELECT 1;', 'pg', false)).toBe('EXPLAIN SELECT 1')
    expect(buildExplain('SELECT 1', 'pg', true)).toBe('EXPLAIN ANALYZE SELECT 1')
  })
  it('sqlite: EXPLAIN QUERY PLAN, analyze ignored', () => {
    expect(buildExplain('SELECT 1', 'sqlite', true)).toBe('EXPLAIN QUERY PLAN SELECT 1')
  })
})

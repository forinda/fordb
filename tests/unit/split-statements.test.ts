import { describe, it, expect } from 'vitest'
import { splitStatements } from '../../src/shared/sql/split-statements'

describe('splitStatements', () => {
  it('splits on top-level semicolons', () => {
    expect(splitStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2'])
  })
  it('ignores semicolons in strings and comments', () => {
    expect(splitStatements(`INSERT INTO t VALUES ('a;b'); -- c;d\nSELECT 1;`)).toEqual([
      `INSERT INTO t VALUES ('a;b')`,
      'SELECT 1'
    ])
  })
  it('keeps doubled-quote escapes inside strings', () => {
    expect(splitStatements(`INSERT INTO t VALUES ('O''Brien; jr'); SELECT 1;`)).toEqual([
      `INSERT INTO t VALUES ('O''Brien; jr')`,
      'SELECT 1'
    ])
  })
  it('ignores block comments and trims empties', () => {
    expect(splitStatements('/* a;b */ SELECT 1;;')).toEqual(['SELECT 1'])
  })
})

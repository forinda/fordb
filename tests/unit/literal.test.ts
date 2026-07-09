import { describe, it, expect } from 'vitest'
import { renderSqlLiteral } from '../../src/shared/sql/literal'

describe('renderSqlLiteral', () => {
  it('null → NULL', () => {
    expect(renderSqlLiteral(null, 'pg')).toBe('NULL')
    expect(renderSqlLiteral(undefined, 'sqlite')).toBe('NULL')
  })
  it('numbers and bigints raw', () => {
    expect(renderSqlLiteral(42, 'pg')).toBe('42')
    expect(renderSqlLiteral(10n, 'pg')).toBe('10')
  })
  it('booleans per dialect', () => {
    expect(renderSqlLiteral(true, 'pg')).toBe('TRUE')
    expect(renderSqlLiteral(false, 'sqlite')).toBe('0')
  })
  it("strings single-quoted with '' escaping", () => {
    expect(renderSqlLiteral("O'Brien", 'pg')).toBe("'O''Brien'")
  })
  it('bytes as hex per dialect', () => {
    expect(renderSqlLiteral(new Uint8Array([0xde, 0xad]), 'pg')).toBe(`'\\xdead'::bytea`)
    expect(renderSqlLiteral(new Uint8Array([0xde, 0xad]), 'sqlite')).toBe(`X'dead'`)
  })
  it('objects JSON-stringified then quoted', () => {
    expect(renderSqlLiteral({ a: 1 }, 'pg')).toBe(`'{"a":1}'`)
  })
  it('NaN/Infinity: pg quoted+cast, sqlite NULL', () => {
    expect(renderSqlLiteral(NaN, 'pg')).toBe(`'NaN'::float8`)
    expect(renderSqlLiteral(Infinity, 'pg')).toBe(`'Infinity'::float8`)
    expect(renderSqlLiteral(-Infinity, 'pg')).toBe(`'-Infinity'::float8`)
    expect(renderSqlLiteral(NaN, 'sqlite')).toBe('NULL')
  })
  it('pg arrays → ARRAY[...] literal (recursive, empty → {})', () => {
    expect(renderSqlLiteral([1, 2, 3], 'pg')).toBe('ARRAY[1, 2, 3]')
    expect(renderSqlLiteral(['a', "b'c"], 'pg')).toBe(`ARRAY['a', 'b''c']`)
    expect(renderSqlLiteral([], 'pg')).toBe(`'{}'`)
  })
})

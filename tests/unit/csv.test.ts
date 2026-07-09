import { describe, it, expect } from 'vitest'
import { parseCsv, stringifyCsv } from '../../src/shared/csv/csv'

describe('csv', () => {
  it('parses quoted fields with commas, newlines, and "" escapes', () => {
    expect(parseCsv('a,b\n"x,y","he said ""hi""\nz"')).toEqual([
      ['a', 'b'],
      ['x,y', 'he said "hi"\nz']
    ])
  })
  it('treats \\r\\n and a lone \\r as row breaks', () => {
    expect(parseCsv('a,b\r\n1,2\r3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4']
    ])
  })
  it('round-trips through stringify', () => {
    const rows = [
      ['id', 'note'],
      ['1', 'a,b'],
      ['2', 'c"d']
    ]
    expect(parseCsv(stringifyCsv(rows))).toEqual(rows)
  })
})

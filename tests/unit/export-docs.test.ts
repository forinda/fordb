import { describe, it, expect } from 'vitest'
import { formatDocsExport } from '../../src/shared/mongo/export-docs'

const docs = [
  { _id: 1, s: 'a' },
  { _id: 2, s: 'b' }
]

describe('formatDocsExport', () => {
  it('json = a pretty-printed array (round-trips)', () => {
    const out = formatDocsExport(docs, 'json')
    expect(out).toContain('\n') // pretty-printed
    expect(JSON.parse(out)).toEqual(docs)
  })

  it('ndjson = one compact document per line', () => {
    const out = formatDocsExport(docs, 'ndjson')
    const lines = out.split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!)).toEqual({ _id: 1, s: 'a' })
    expect(lines[0]).not.toContain('\n ') // compact, no indentation
  })

  it('empty input yields [] / empty string', () => {
    expect(formatDocsExport([], 'json')).toBe('[]')
    expect(formatDocsExport([], 'ndjson')).toBe('')
  })
})

import { describe, it, expect } from 'vitest'
import { fanoutEdit, cloneRows } from '../../src/shared/mutation/bulk-edits'

describe('fanoutEdit', () => {
  it('applies a value to one row', () => {
    expect(fanoutEdit({}, [3], 'label', 'x')).toEqual({ '3:label': 'x' })
  })
  it('applies a value to every target row for the column', () => {
    expect(fanoutEdit({}, [1, 2, 5], 'status', 'done')).toEqual({
      '1:status': 'done',
      '2:status': 'done',
      '5:status': 'done'
    })
  })
  it('preserves existing edits and overwrites the same cell', () => {
    const existing = { '1:label': 'old', '9:other': 'keep' }
    expect(fanoutEdit(existing, [1, 2], 'label', 'new')).toEqual({
      '1:label': 'new',
      '2:label': 'new',
      '9:other': 'keep'
    })
  })
  it('carries a null value', () => {
    expect(fanoutEdit({}, [4], 'note', null)).toEqual({ '4:note': null })
  })
})

describe('cloneRows', () => {
  it('drops pk columns, keeps the rest', () => {
    const rows = [{ id: '1', label: 'a', note: null }]
    expect(cloneRows(rows, ['id'])).toEqual([{ label: 'a', note: null }])
  })
  it('clones each input row', () => {
    const rows = [
      { id: '1', label: 'a' },
      { id: '2', label: 'b' }
    ]
    expect(cloneRows(rows, ['id'])).toEqual([{ label: 'a' }, { label: 'b' }])
  })
  it('drops composite pk columns', () => {
    const rows = [{ a: '1', b: '2', c: 'keep' }]
    expect(cloneRows(rows, ['a', 'b'])).toEqual([{ c: 'keep' }])
  })
  it('keeps everything when there is no pk', () => {
    const rows = [{ x: '1', y: '2' }]
    expect(cloneRows(rows, [])).toEqual([{ x: '1', y: '2' }])
  })
})

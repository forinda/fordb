import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QueryLibraryStore } from '../../src/main/query-library-store'

let store: QueryLibraryStore
beforeEach(() => {
  store = new QueryLibraryStore(join(mkdtempSync(join(tmpdir(), 'fordb-ql-')), 'q.json'))
})

describe('QueryLibraryStore', () => {
  it('history: prepend newest-first, dedup consecutive, cap 200, per-profile', async () => {
    await store.addHistory('p1', 'A')
    await store.addHistory('p1', 'A')
    await store.addHistory('p1', 'B')
    await store.addHistory('p2', 'Z')
    expect((await store.listHistory('p1')).map((h) => h.sql)).toEqual(['B', 'A'])
    expect((await store.listHistory('p2')).map((h) => h.sql)).toEqual(['Z'])
    for (let i = 0; i < 250; i++) await store.addHistory('p3', `q${i}`)
    expect(await store.listHistory('p3')).toHaveLength(200)
  })
  it('saved: save/list/delete, per-profile, stable ids', async () => {
    const a = await store.saveQuery('p1', 'first', 'SELECT 1')
    const b = await store.saveQuery('p1', 'second', 'SELECT 2')
    expect((await store.listSaved('p1')).map((s) => s.name)).toEqual(['first', 'second'])
    await store.deleteSaved('p1', a.id)
    expect((await store.listSaved('p1')).map((s) => s.id)).toEqual([b.id])
    expect(await store.listSaved('p2')).toEqual([])
  })
  it('missing file reads as empty', async () => {
    expect(await store.listHistory('nope')).toEqual([])
    expect(await store.listSaved('nope')).toEqual([])
  })
})

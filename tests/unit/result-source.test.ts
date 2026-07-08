import { describe, it, expect } from 'vitest'
import { QueryResultSource } from '../../src/renderer/src/query/result-source'
import type { Page } from '../../src/shared/adapter/types'

function fakeApi(total: number, pageSize: number): {
  closedFlag: () => boolean
  fetchPage: (q: string) => Promise<Page>
  closeQuery: (q: string) => Promise<void>
} {
  let served = 0
  let closed = false
  return {
    closedFlag: () => closed,
    fetchPage: async (): Promise<Page> => {
      const remaining = total - served
      const n = Math.min(pageSize, remaining)
      const rows = Array.from({ length: n }, (_, i) => [served + i])
      served += n
      return { rows, done: served >= total }
    },
    closeQuery: async (): Promise<void> => {
      closed = true
    }
  }
}

describe('QueryResultSource', () => {
  it('lazily loads rows up to an index', async () => {
    const api = fakeApi(2500, 1000)
    const src = new QueryResultSource(api, 'q1', [{ name: 'id', dataType: '23' }], 1000)
    expect(src.loadedRowCount()).toBe(0)
    await src.ensureLoaded(500)
    expect(src.loadedRowCount()).toBe(1000)
    expect(src.getRow(0)).toEqual([0])
    await src.ensureLoaded(1500)
    expect(src.loadedRowCount()).toBe(2000)
  })
  it('drainAll loads everything and sets done', async () => {
    const api = fakeApi(2500, 1000)
    const src = new QueryResultSource(api, 'q1', [], 1000)
    await src.drainAll()
    expect(src.loadedRowCount()).toBe(2500)
    expect(src.done()).toBe(true)
  })
  it('does not fetch past done', async () => {
    const api = fakeApi(1500, 1000)
    const src = new QueryResultSource(api, 'q1', [], 1000)
    await src.drainAll()
    const before = src.loadedRowCount()
    await src.ensureLoaded(100000)
    expect(src.loadedRowCount()).toBe(before)
  })
  it('dispose closes the cursor', async () => {
    const api = fakeApi(10, 5)
    const src = new QueryResultSource(api, 'q1', [], 5)
    await src.dispose()
    expect(api.closedFlag()).toBe(true)
  })
})

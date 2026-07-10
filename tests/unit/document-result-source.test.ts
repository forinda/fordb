import { describe, it, expect } from 'vitest'
import { DocumentResultSource } from '../../src/renderer/src/query/documents'

function fakeApi(pages: Record<string, unknown>[][]): {
  fetchDocs: () => Promise<{ docs: Record<string, unknown>[]; done: boolean }>
  closeDocs: () => Promise<void>
} {
  let i = 0
  return {
    fetchDocs: async () => ({ docs: pages[i] ?? [], done: ++i >= pages.length }),
    closeDocs: async () => {}
  }
}

describe('DocumentResultSource', () => {
  it('accumulates paged documents and marks done', async () => {
    const src = new DocumentResultSource(fakeApi([[{ a: 1 }, { a: 2 }], [{ a: 3 }]]), 'q1')
    await src.loadMore()
    expect(src.docs.length).toBe(2)
    expect(src.done).toBe(false)
    await src.loadMore()
    expect(src.docs.length).toBe(3)
    expect(src.done).toBe(true)
  })

  it('serializes overlapping loadMore() calls onto a single in-flight fetch', async () => {
    let fetchCount = 0
    let resolvePage: ((page: { docs: Record<string, unknown>[]; done: boolean }) => void) | null =
      null
    const api = {
      fetchDocs: () =>
        new Promise<{ docs: Record<string, unknown>[]; done: boolean }>((resolve) => {
          fetchCount++
          resolvePage = resolve
        }),
      closeDocs: async () => {}
    }
    const src = new DocumentResultSource(api, 'q1')

    // Two overlapping calls before the first fetch resolves must share one
    // in-flight fetch, not issue two concurrent fetchDocs calls.
    const p1 = src.loadMore()
    const p2 = src.loadMore()
    expect(fetchCount).toBe(1)
    resolvePage!({ docs: [{ a: 1 }], done: false })
    await Promise.all([p1, p2])
    expect(src.docs.length).toBe(1)

    // Once settled, a later call issues a fresh fetch (not stuck on the old one).
    const p3 = src.loadMore()
    expect(fetchCount).toBe(2)
    resolvePage!({ docs: [{ a: 2 }], done: true })
    await p3
    expect(src.docs.length).toBe(2)
    expect(src.done).toBe(true)
  })
})

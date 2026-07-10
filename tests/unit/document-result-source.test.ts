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
})

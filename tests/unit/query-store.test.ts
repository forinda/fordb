import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted so the spies exist when the hoisted vi.mock factories run.
const h = vi.hoisted(() => ({
  openQuery: vi.fn(async () => ({ queryId: 'q1', fields: [{ name: 'id', dataType: '23' }] })),
  fetchPage: vi.fn(),
  closeQuery: vi.fn(async () => {})
}))

vi.mock('../../src/renderer/src/rpc', () => ({
  hostApi: async () => ({
    openQuery: h.openQuery,
    fetchPage: h.fetchPage,
    closeQuery: h.closeQuery
  })
}))
vi.mock('../../src/renderer/src/store', () => ({
  useConnStore: { getState: () => ({ activeConnectionId: 'conn1' }) }
}))

import { useQueryStore } from '../../src/renderer/src/store-query'

beforeEach(() => {
  useQueryStore.setState({ tabs: [], activeTabId: null })
  h.closeQuery.mockClear()
  h.fetchPage.mockReset()
})

describe('useQueryStore.run cursor lifecycle', () => {
  it('disposes the cursor (closeQuery) when the first page fetch fails', async () => {
    h.fetchPage.mockRejectedValue(new Error('db-host died mid-fetch'))
    const s = useQueryStore.getState()
    s.newTab()
    const id = useQueryStore.getState().activeTabId!
    s.setSql(id, 'SELECT * FROM app.users')
    await s.run(id)

    const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.status).toBe('error')
    expect(tab.source).toBeUndefined()
    // The server cursor opened by openQuery must be closed, not leaked.
    expect(h.closeQuery).toHaveBeenCalledWith('conn1', 'q1')
  })
})

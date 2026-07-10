import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted so the spies exist when the hoisted vi.mock factories run.
const h = vi.hoisted(() => ({
  openQuery: vi.fn(async () => ({ queryId: 'q1', fields: [{ name: 'id', dataType: '23' }] })),
  fetchPage: vi.fn(),
  closeQuery: vi.fn(async () => {}),
  findDocs: vi.fn(async () => ({ queryId: 'd1' })),
  aggregateDocs: vi.fn(async () => ({ queryId: 'd1' })),
  fetchDocs: vi.fn(async () => ({ docs: [], done: true })),
  closeDocs: vi.fn(async () => {})
}))

vi.mock('../../src/renderer/src/rpc', () => ({
  hostApi: async () => ({
    openQuery: h.openQuery,
    fetchPage: h.fetchPage,
    closeQuery: h.closeQuery,
    findDocs: h.findDocs,
    aggregateDocs: h.aggregateDocs,
    fetchDocs: h.fetchDocs,
    closeDocs: h.closeDocs
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
  h.findDocs.mockClear()
  h.aggregateDocs.mockClear()
  h.fetchDocs.mockClear()
  h.closeDocs.mockClear()
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

describe('useQueryStore.run document-mode aggregate validation', () => {
  it('rejects a non-array aggregate pipeline without calling the engine', async () => {
    const s = useQueryStore.getState()
    await s.openCollection('users') // find tab, runs once against findDocs
    const id = useQueryStore.getState().activeTabId!
    s.setDoc(id, { mode: 'aggregate', text: '{ foo: 1 }' }) // object, not an array
    await s.run(id)

    const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.status).toBe('error')
    expect(tab.message).toBe('Aggregate pipeline must be a JSON array')
    expect(h.aggregateDocs).not.toHaveBeenCalled()
  })

  it('runs an array aggregate pipeline against the engine', async () => {
    const s = useQueryStore.getState()
    await s.openCollection('users')
    const id = useQueryStore.getState().activeTabId!
    s.setDoc(id, { mode: 'aggregate', text: '[{ $match: {} }]' })
    await s.run(id)

    const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.status).toBe('done')
    expect(h.aggregateDocs).toHaveBeenCalledWith('conn1', 'users', [{ $match: {} }], 50)
  })
})

describe('useQueryStore document-tab guards', () => {
  it('loadIntoEditor opens a fresh tab instead of overwriting a document tab', async () => {
    const s = useQueryStore.getState()
    await s.openCollection('users')
    const docTabId = useQueryStore.getState().activeTabId!
    const before = useQueryStore.getState().tabs.length

    s.loadIntoEditor('SELECT 1')

    const after = useQueryStore.getState()
    expect(after.tabs.length).toBe(before + 1)
    expect(after.activeTabId).not.toBe(docTabId)
    const docTab = after.tabs.find((t) => t.id === docTabId)!
    expect(docTab.doc?.text).toBe('{}') // untouched
  })

  it('formatActive and openExplain no-op on a document tab', async () => {
    const s = useQueryStore.getState()
    await s.openCollection('users')
    const docTabId = useQueryStore.getState().activeTabId!
    const before = useQueryStore.getState().tabs.length
    const docTabBefore = useQueryStore.getState().tabs.find((t) => t.id === docTabId)!
    const sqlBefore = docTabBefore.sql
    const docTextBefore = docTabBefore.doc?.text

    s.formatActive('postgresql')
    await s.openExplain('pg', false)
    // Give the event loop time so a (incorrectly) unguarded formatActive's
    // dynamic sql-formatter import + reformat would have landed by now —
    // 'users.find()' reformats to 'users.find ()', so this actually
    // distinguishes guard-present from guard-absent.
    await new Promise((resolve) => setTimeout(resolve, 200))

    const after = useQueryStore.getState()
    expect(after.tabs.length).toBe(before) // openExplain didn't open a new tab
    expect(after.activeTabId).toBe(docTabId)
    const docTabAfter = after.tabs.find((t) => t.id === docTabId)!
    expect(docTabAfter.sql).toBe(sqlBefore) // formatActive left the doc tab's sql untouched
    expect(docTabAfter.doc?.text).toBe(docTextBefore) // and its query text untouched
  })
})

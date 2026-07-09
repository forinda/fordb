import { create } from 'zustand'
import { hostApi } from './rpc'
import { useConnStore } from './store'
import { isSelectLike } from '@shared/sql/classify'
import { QueryResultSource } from '@shared/query/result-source'
import { queryClient } from './query/client'
import { invalidateIntrospection } from './query/introspection'

const PAGE_SIZE = 1000

export type TabStatus = 'idle' | 'running' | 'done' | 'error'
export interface QueryTab {
  id: string
  sql: string
  status: TabStatus
  source?: QueryResultSource
  message?: string // rowCount/command summary or error text
  elapsedMs?: number
}

let seq = 0
function tabId(): string {
  return `t${++seq}`
}

interface QueryState {
  tabs: QueryTab[]
  activeTabId: string | null
  mainView: 'query' | 'dashboard'
  newTab: () => void
  closeTab: (id: string) => void
  setSql: (id: string, sql: string) => void
  setActive: (id: string) => void
  run: (id: string) => Promise<void>
  cancel: (id: string) => Promise<void>
  connectionLost: () => void
  setMainView: (v: 'query' | 'dashboard') => void
}

function patch(tabs: QueryTab[], id: string, over: Partial<QueryTab>): QueryTab[] {
  return tabs.map((t) => (t.id === id ? { ...t, ...over } : t))
}

export const useQueryStore = create<QueryState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  mainView: 'query',
  setMainView: (v) => set({ mainView: v }),
  newTab: () => {
    const t: QueryTab = { id: tabId(), sql: '', status: 'idle' }
    set((s) => ({ tabs: [...s.tabs, t], activeTabId: t.id }))
  },
  closeTab: (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    void tab?.source?.dispose()
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id)
      return { tabs, activeTabId: s.activeTabId === id ? (tabs[0]?.id ?? null) : s.activeTabId }
    })
  },
  setSql: (id, sql) => set((s) => ({ tabs: patch(s.tabs, id, { sql }) })),
  setActive: (id) => set({ activeTabId: id }),
  run: async (id) => {
    const connId = useConnStore.getState().activeConnectionId
    const tab = get().tabs.find((t) => t.id === id)
    if (!connId || !tab) return
    void tab.source?.dispose()
    set((s) => ({
      tabs: patch(s.tabs, id, { status: 'running', source: undefined, message: undefined })
    }))
    const started = performance.now()
    try {
      const api = await hostApi()
      if (isSelectLike(tab.sql)) {
        const open = await api.openQuery(connId, tab.sql, PAGE_SIZE)
        const source = new QueryResultSource(
          {
            fetchPage: (q) => api.fetchPage(connId, q),
            closeQuery: (q) => api.closeQuery(connId, q)
          },
          open.queryId,
          open.fields,
          PAGE_SIZE
        )
        // Store the source on the tab BEFORE awaiting the first page, so that a
        // rejecting fetchPage lands in catch with the source reachable (and
        // therefore disposable) — otherwise the server cursor would leak.
        set((s) => ({ tabs: patch(s.tabs, id, { source }) }))
        await source.ensureLoaded(0) // first page
        set((s) => ({
          tabs: patch(s.tabs, id, {
            status: 'done',
            elapsedMs: performance.now() - started
          })
        }))
      } else {
        const r = await api.executeQuery(connId, tab.sql)
        set((s) => ({
          tabs: patch(s.tabs, id, {
            status: 'done',
            message: `${r.command} ${r.rowCount}`,
            elapsedMs: performance.now() - started
          })
        }))
        // A non-SELECT may have been DDL — the schema could have changed.
        void invalidateIntrospection(queryClient, connId)
      }
    } catch (err) {
      const cur = get().tabs.find((t) => t.id === id)?.source
      void cur?.dispose()
      set((s) => ({
        tabs: patch(s.tabs, id, {
          status: 'error',
          source: undefined,
          message: err instanceof Error ? err.message : String(err)
        })
      }))
    }
  },
  cancel: async (id) => {
    const connId = useConnStore.getState().activeConnectionId
    if (connId) await (await hostApi()).cancel(connId)
    set((s) => ({ tabs: patch(s.tabs, id, { status: 'idle' }) }))
  },
  connectionLost: () => {
    for (const t of get().tabs) void t.source?.dispose()
    // Clear the active connection so connection-scoped polling (the server-stats
    // dashboard's refetchInterval hooks are enabled-gated on connId) stops
    // instead of looping forever against the now-dead db-host connection.
    useConnStore.getState().clearActive()
    set((s) => ({
      tabs: s.tabs.map((t) => ({
        ...t,
        source: undefined,
        status: 'error' as TabStatus,
        message: 'Connection lost — reconnect'
      }))
    }))
  }
}))

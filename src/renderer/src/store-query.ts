import { create } from 'zustand'
import { hostApi } from './rpc'
import { useConnStore } from './store'
import { isSelectLike } from '@shared/sql/classify'
import { QueryResultSource } from '@shared/query/result-source'
import { queryClient } from './query/client'
import { invalidateIntrospection } from './query/introspection'
import type { RowEdit } from '@shared/adapter/mutation-types'
import type { Filter, Sort } from '@shared/adapter/browse-types'

const PAGE_SIZE = 1000

export type TabStatus = 'idle' | 'running' | 'done' | 'error'
export interface QueryTab {
  id: string
  sql: string
  status: TabStatus
  source?: QueryResultSource
  message?: string // rowCount/command summary or error text
  elapsedMs?: number
  kind: 'query' | 'data' | 'structure'
  /** Present on data tabs — the table being browsed/edited. `editable` is true
   *  only when the engine supports mutation AND the table has a pk/unique key.
   *  `browse` holds the current filter/sort (run() sends it to openBrowse);
   *  `fkColumns` maps a single-column FK's local column → its referenced table. */
  data?: {
    schema: string
    table: string
    pkColumns: string[]
    editable: boolean
    browse: { filters: Filter[]; sort: Sort[] }
    fkColumns: Record<string, string>
  }
  /** Present on structure tabs — the table whose DDL structure is shown/edited. */
  structure?: { schema: string; table: string }
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
  openTable: (schema: string, table: string, initialFilters?: Filter[]) => Promise<void>
  setBrowse: (tabId: string, browse: { filters: Filter[]; sort: Sort[] }) => void
  openFkTarget: (schema: string, refTable: string, value: unknown) => Promise<void>
  applyEdits: (tabId: string, edits: RowEdit[]) => Promise<void>
  openStructure: (schema: string, table: string) => void
  applyDdl: (statements: string[]) => Promise<void>
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
    const t: QueryTab = { id: tabId(), sql: '', status: 'idle', kind: 'query' }
    set((s) => ({ tabs: [...s.tabs, t], activeTabId: t.id }))
  },
  openTable: async (schema, table, initialFilters) => {
    const connId = useConnStore.getState().activeConnectionId
    if (!connId) return
    const api = await hostApi()
    const [keys, mutable] = await Promise.all([
      api.getKeys(connId, schema, table),
      api.mutationSupported(connId)
    ])
    const pk = keys.find((k) => k.kind === 'primary') ?? keys.find((k) => k.kind === 'unique')
    const pkColumns = pk?.columns ?? []
    // Single-column FKs → clickable navigation to the referenced table.
    const fkColumns: Record<string, string> = {}
    for (const k of keys)
      if (k.kind === 'foreign' && k.columns.length === 1 && k.referencedTable)
        fkColumns[k.columns[0]!] = k.referencedTable
    const id = tabId()
    const tab: QueryTab = {
      id,
      sql: `browse ${schema}.${table}`,
      status: 'idle',
      kind: 'data',
      data: {
        schema,
        table,
        pkColumns,
        editable: mutable && pkColumns.length > 0,
        fkColumns,
        // Default sort = pk (stable row index within a page); empty → no ORDER BY.
        browse: {
          filters: initialFilters ?? [],
          sort: pkColumns.map((c) => ({ column: c, dir: 'asc' as const }))
        }
      }
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
    await get().run(id) // streams via openBrowse (data-tab branch)
  },
  setBrowse: (tabId, browse) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.data ? { ...t, data: { ...t.data, browse } } : t
      )
    }))
    void get().run(tabId)
  },
  openFkTarget: async (schema, refTable, value) => {
    const connId = useConnStore.getState().activeConnectionId
    if (!connId) return
    const keys = await (await hostApi()).getKeys(connId, schema, refTable)
    const pk = keys.find((k) => k.kind === 'primary')
    const filters: Filter[] =
      pk && pk.columns.length === 1 ? [{ column: pk.columns[0]!, op: 'eq', value }] : []
    await get().openTable(schema, refTable, filters)
  },
  applyEdits: async (tabId, edits) => {
    const connId = useConnStore.getState().activeConnectionId
    if (!connId) return
    await (await hostApi()).applyEdits(connId, edits)
    await get().run(tabId) // refresh the data view
  },
  openStructure: (schema, table) => {
    const id = tabId()
    const tab: QueryTab = {
      id,
      sql: `structure ${schema}.${table}`,
      status: 'done',
      kind: 'structure',
      structure: { schema, table }
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
  },
  applyDdl: async (statements) => {
    const connId = useConnStore.getState().activeConnectionId
    // Throw (don't silently no-op) so the caller's try/catch surfaces "nothing
    // applied" instead of closing its form as if the DDL succeeded.
    if (!connId) throw new Error('No active connection')
    await (await hostApi()).applyDdl(connId, statements)
    // Await the refetch so callers (StructureView) don't build the NEXT rebuild's
    // TableStructure context from pre-change columns/keys — a stale context can
    // reference a column the prior rebuild renamed away.
    await invalidateIntrospection(queryClient, connId)
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
      if (tab.kind === 'data' && tab.data) {
        const open = await api.openBrowse(connId, {
          schema: tab.data.schema,
          table: tab.data.table,
          filters: tab.data.browse.filters,
          sort: tab.data.browse.sort,
          pageSize: PAGE_SIZE
        })
        const source = new QueryResultSource(
          {
            fetchPage: (q) => api.fetchPage(connId, q),
            closeQuery: (q) => api.closeQuery(connId, q)
          },
          open.queryId,
          open.fields,
          PAGE_SIZE
        )
        set((s) => ({ tabs: patch(s.tabs, id, { source }) }))
        await source.ensureLoaded(0)
        set((s) => ({
          tabs: patch(s.tabs, id, { status: 'done', elapsedMs: performance.now() - started })
        }))
        return
      }
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

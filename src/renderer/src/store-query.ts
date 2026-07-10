import { create } from 'zustand'
import { hostApi } from './rpc'
import { useConnStore } from './store'
import { isSelectLike } from '@shared/sql/classify'
import { QueryResultSource } from '@shared/query/result-source'
import { queryClient } from './query/client'
import { invalidateIntrospection } from './query/introspection'
import { buildExplain } from '@shared/sql/explain'
import { reconstructDdl } from '@shared/ddl/build-ddl'
import { buildInsert } from '@shared/sql/build-insert'
import { quoteIdent } from '@shared/mutation/build-edits'
import { splitStatements } from '@shared/sql/split-statements'
import { parseCsv } from '@shared/csv/csv'
import { parseRelaxed } from '@shared/mongo/relaxed-json'
import type { RowEdit } from '@shared/adapter/mutation-types'
import type { Filter, Sort } from '@shared/adapter/browse-types'
import type { ObjectKind } from '@shared/adapter/object-types'
import { buildDdl } from '@shared/ddl/build-ddl'
import { DocumentResultSource } from './query/documents'

const PAGE_SIZE = 1000
const DOC_PAGE_SIZE = 50

export type TabStatus = 'idle' | 'running' | 'done' | 'error'
export interface QueryTab {
  id: string
  sql: string
  status: TabStatus
  source?: QueryResultSource
  message?: string // rowCount/command summary or error text
  elapsedMs?: number
  kind: 'query' | 'data' | 'structure' | 'explain' | 'object'
  /** Present on explain tabs — the plan rows (one string per line). */
  explainRows?: string[]
  /** Present on object tabs — the object whose definition is shown. */
  object?: { schema: string; kind: ObjectKind; name: string }
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
  /** Present on document-mode tabs (MongoDB) — the collection + relaxed-JSON
   *  query text run() parses via parseRelaxed before dispatch. */
  doc?: {
    collection: string
    mode: 'find' | 'aggregate'
    text: string
    projection?: string
    sort?: string
    limit?: number
  }
  /** Accumulates cursor-paged documents for a document-mode tab's run. */
  docSource?: DocumentResultSource
}

let seq = 0
function tabId(): string {
  return `t${++seq}`
}

export type PickerKind = 'history' | 'saved' | 'save' | null

interface QueryState {
  tabs: QueryTab[]
  activeTabId: string | null
  mainView: 'query' | 'dashboard'
  picker: PickerKind
  setPicker: (p: PickerKind) => void
  loadIntoEditor: (sql: string) => void
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
  /** Opens a new document-mode tab for a MongoDB collection (default find/{}). */
  openCollection: (collection: string) => Promise<void>
  setDoc: (id: string, patch: Partial<NonNullable<QueryTab['doc']>>) => void
  /** Inserts a new document into the tab's collection, then refetches the tab. */
  insertDoc: (tabId: string, doc: Record<string, unknown>) => Promise<void>
  /** Applies a $set patch to a document by `_id`, then refetches the tab. */
  updateDoc: (tabId: string, docId: unknown, patch: Record<string, unknown>) => Promise<void>
  /** Deletes a document by `_id`, then refetches the tab. */
  deleteDoc: (tabId: string, docId: unknown) => Promise<void>
  openFkTarget: (schema: string, refTable: string, value: unknown) => Promise<void>
  applyEdits: (tabId: string, edits: RowEdit[]) => Promise<void>
  openStructure: (schema: string, table: string) => void
  openObjectDefinition: (schema: string, kind: ObjectKind, name: string) => void
  createView: (
    schema: string,
    name: string,
    select: string,
    dialect: 'pg' | 'sqlite'
  ) => Promise<void>
  dropView: (schema: string, name: string, dialect: 'pg' | 'sqlite') => Promise<void>
  applyDdl: (statements: string[]) => Promise<void>
  formatActive: (sqlLang: 'postgresql' | 'sqlite') => void
  openExplain: (dialect: 'pg' | 'sqlite', analyze: boolean) => Promise<void>
  exportSql: (scope: ExportScope, gzip: boolean, dialect: 'pg' | 'sqlite') => Promise<void>
  importSqlFile: () => Promise<void>
  /** Last export/import failure, shown in a global banner. */
  ioError: string | null
  clearIoError: () => void
  csvImport: { schema: string; table: string; headers: string[]; rows: string[][] } | null
  beginCsvImport: (schema: string, table: string) => Promise<void>
  cancelCsvImport: () => void
  applyCsvImport: (mapping: (string | null)[]) => Promise<void>
}

export type ExportScope =
  { kind: 'table'; schema: string; table: string } | { kind: 'database'; schema: string }

function patch(tabs: QueryTab[], id: string, over: Partial<QueryTab>): QueryTab[] {
  return tabs.map((t) => (t.id === id ? { ...t, ...over } : t))
}

export const useQueryStore = create<QueryState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  mainView: 'query',
  ioError: null,
  clearIoError: () => set({ ioError: null }),
  csvImport: null,
  beginCsvImport: async (schema, table) => {
    const connId = useConnStore.getState().activeConnectionId
    if (!connId) return
    if (!(await (await hostApi()).mutationSupported(connId))) {
      set({ ioError: 'This engine/table does not support inserting rows.' })
      return
    }
    const picked = await window.fordb.dialog.openTextFile(['csv'])
    if (!picked) return
    const rows = parseCsv(picked.text).filter((r) => r.length > 0)
    if (rows.length === 0) return
    const [headers, ...data] = rows
    set({ csvImport: { schema, table, headers: headers ?? [], rows: data }, ioError: null })
  },
  cancelCsvImport: () => set({ csvImport: null }),
  applyCsvImport: async (mapping) => {
    const connId = useConnStore.getState().activeConnectionId
    const job = get().csvImport
    if (!connId || !job) return
    // mapping[i] = target column for CSV column i (null = skip).
    const edits: RowEdit[] = job.rows.map((row) => ({
      kind: 'insert' as const,
      schema: job.schema,
      table: job.table,
      values: mapping.flatMap((col, i) => (col ? [{ column: col, value: row[i] ?? null }] : []))
    }))
    try {
      await (await hostApi()).applyEdits(connId, edits)
      void invalidateIntrospection(queryClient, connId)
      set({ csvImport: null })
    } catch (err) {
      set({ ioError: err instanceof Error ? err.message : String(err) })
    }
  },
  picker: null,
  setPicker: (p) => set({ picker: p }),
  loadIntoEditor: (sql) => {
    const s = get()
    const active = s.tabs.find((t) => t.id === s.activeTabId)
    if (active && active.kind === 'query' && !active.doc) {
      get().setSql(active.id, sql)
      return
    }
    // Active tab isn't an editor (data/structure/explain) → open a fresh one.
    const id = tabId()
    set((st) => ({
      tabs: [...st.tabs, { id, sql, status: 'idle', kind: 'query' }],
      activeTabId: id
    }))
  },
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
  openCollection: async (collection) => {
    const id = tabId()
    const tab: QueryTab = {
      id,
      sql: `${collection}.find()`,
      status: 'idle',
      kind: 'query',
      doc: { collection, mode: 'find', text: '{}' }
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
    await get().run(id)
  },
  setDoc: (id, docPatch) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id && t.doc ? { ...t, doc: { ...t.doc, ...docPatch } } : t))
    }))
  },
  insertDoc: async (tabId, doc) => {
    const connId = useConnStore.getState().activeConnectionId
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!connId || !tab?.doc) return
    await (await hostApi()).insertDoc(connId, tab.doc.collection, doc)
    await get().run(tabId) // refresh the document view
  },
  updateDoc: async (tabId, docId, patch) => {
    const connId = useConnStore.getState().activeConnectionId
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!connId || !tab?.doc) return
    await (await hostApi()).updateDoc(connId, tab.doc.collection, docId, patch)
    await get().run(tabId) // refresh the document view
  },
  deleteDoc: async (tabId, docId) => {
    const connId = useConnStore.getState().activeConnectionId
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!connId || !tab?.doc) return
    await (await hostApi()).deleteDoc(connId, tab.doc.collection, docId)
    await get().run(tabId) // refresh the document view
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
  openObjectDefinition: (schema, kind, name) => {
    const id = tabId()
    const tab: QueryTab = {
      id,
      sql: `${kind} ${schema}.${name}`,
      status: 'done',
      kind: 'object',
      object: { schema, kind, name }
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
  },
  createView: async (schema, name, select, dialect) => {
    await get().applyDdl(buildDdl({ kind: 'createView', schema, name, select }, dialect))
  },
  dropView: async (schema, name, dialect) => {
    await get().applyDdl(buildDdl({ kind: 'dropView', schema, name }, dialect))
  },
  openExplain: async (dialect, analyze) => {
    const src = get().tabs.find((t) => t.id === get().activeTabId)
    // Only explain a real editor's SQL — a data/structure/explain tab's `sql` is
    // an internal placeholder ("browse s.t", "structure s.t") that isn't runnable,
    // and a document-mode tab's `sql` is a display label, not runnable SQL either.
    if (!src || src.kind !== 'query' || src.doc || !src.sql.trim()) return
    const id = tabId()
    const tab: QueryTab = {
      id,
      sql: buildExplain(src.sql, dialect, analyze),
      status: 'idle',
      kind: 'explain'
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
    await get().run(id)
  },
  exportSql: async (scope, gzip, dialect) => {
    const connId = useConnStore.getState().activeConnectionId
    if (!connId) return
    set({ ioError: null })
    const api = await hostApi()
    try {
      const tables =
        scope.kind === 'table'
          ? [scope.table]
          : (await api.listTables(connId, scope.schema))
              .filter((t) => t.type === 'table')
              .map((t) => t.name)
      const parts: string[] = ['-- fordb dump\n\n']
      for (const table of tables) {
        const [cols, keys, indexes] = await Promise.all([
          api.getColumns(connId, scope.schema, table),
          api.getKeys(connId, scope.schema, table),
          api.getIndexes(connId, scope.schema, table)
        ])
        parts.push(reconstructDdl(cols, keys, indexes, scope.schema, table, dialect) + '\n')
        const colNames = cols.map((c) => c.name)
        const open = await api.openQuery(
          connId,
          `SELECT * FROM ${quoteIdent(scope.schema)}.${quoteIdent(table)}`,
          1000
        )
        try {
          for (;;) {
            const page = await api.fetchPage(connId, open.queryId)
            for (const row of page.rows)
              parts.push(buildInsert(scope.schema, table, colNames, row, dialect) + ';\n')
            if (page.done) break
          }
        } catch (err) {
          // Close the cursor on a mid-dump failure (it self-closes only on `done`).
          await api.closeQuery(connId, open.queryId).catch(() => {})
          throw err
        }
        parts.push('\n')
      }
      const name = scope.kind === 'table' ? `${scope.table}.sql` : `${scope.schema}.sql`
      await window.fordb.exportFile.save(name, parts.join(''), gzip)
    } catch (err) {
      set({ ioError: err instanceof Error ? err.message : String(err) })
    }
  },
  importSqlFile: async () => {
    const connId = useConnStore.getState().activeConnectionId
    if (!connId) return
    // Accept .sql and .sql.gz (main gunzips transparently).
    const picked = await window.fordb.dialog.openTextFile(['sql', 'gz'])
    if (!picked) return
    set({ ioError: null })
    try {
      // Drop the script's own transaction control — executeScript wraps the whole
      // batch in one transaction, and a nested BEGIN/COMMIT (pg_dump, sqlite .dump)
      // would break that (SQLite errors, PG silently auto-commits mid-script).
      const statements = splitStatements(picked.text).filter(
        (s) => !/^\s*(BEGIN|COMMIT|END|ROLLBACK|START\s+TRANSACTION)\b/i.test(s)
      )
      await (await hostApi()).executeScript(connId, statements)
      void invalidateIntrospection(queryClient, connId)
    } catch (err) {
      set({ ioError: err instanceof Error ? err.message : String(err) })
    }
  },
  formatActive: (sqlLang) => {
    const s = get()
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    if (!tab || tab.kind !== 'query' || tab.doc || !tab.sql.trim()) return
    // Lazy import keeps sql-formatter off the initial bundle path. A parse error
    // OR a chunk-load failure leaves the SQL untouched (best-effort prettify).
    void import('sql-formatter')
      .then(({ format }) => {
        get().setSql(tab.id, format(tab.sql, { language: sqlLang, keywordCase: 'upper' }))
      })
      .catch(() => {})
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
    void tab?.docSource?.dispose()
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
    void tab.docSource?.dispose()
    set((s) => ({
      tabs: patch(s.tabs, id, {
        status: 'running',
        source: undefined,
        docSource: undefined,
        message: undefined
      })
    }))
    const started = performance.now()
    try {
      const api = await hostApi()
      if (tab.kind === 'explain') {
        const r = await api.executeQuery(connId, tab.sql)
        set((s) => ({
          tabs: patch(s.tabs, id, {
            status: 'done',
            explainRows: r.rows.map((row) =>
              row.map((c) => (c == null ? '' : String(c))).join('  ')
            ),
            elapsedMs: performance.now() - started
          })
        }))
        return
      }
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
      if (tab.doc) {
        const { collection, mode, text } = tab.doc
        const parsed = parseRelaxed(text) // throws → caught below, shown as parse error
        if (mode === 'aggregate' && !Array.isArray(parsed)) {
          set((s) => ({
            tabs: patch(s.tabs, id, {
              status: 'error',
              message: 'Aggregate pipeline must be a JSON array'
            })
          }))
          return
        }
        const open =
          mode === 'find'
            ? await api.findDocs(
                connId,
                collection,
                parsed as Record<string, unknown>,
                { limit: tab.doc.limit },
                DOC_PAGE_SIZE
              )
            : await api.aggregateDocs(
                connId,
                collection,
                parsed as Record<string, unknown>[],
                DOC_PAGE_SIZE
              )
        const source = new DocumentResultSource(
          {
            fetchDocs: (q) => api.fetchDocs(connId, q),
            closeDocs: (q) => api.closeDocs(connId, q)
          },
          open.queryId
        )
        // Store the source on the tab BEFORE awaiting the first page, so that a
        // rejecting fetchDocs lands in catch with the source reachable (and
        // therefore disposable) — otherwise the server cursor would leak.
        set((s) => ({ tabs: patch(s.tabs, id, { docSource: source }) }))
        await source.loadMore()
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
      // Record the successful run in the per-profile history (fire-and-forget).
      const profileId = useConnStore.getState().activeProfileId
      if (profileId) void window.fordb.queries.historyAdd(profileId, tab.sql).catch(() => {})
    } catch (err) {
      const cur = get().tabs.find((t) => t.id === id)
      void cur?.source?.dispose()
      void cur?.docSource?.dispose()
      set((s) => ({
        tabs: patch(s.tabs, id, {
          status: 'error',
          source: undefined,
          docSource: undefined,
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
    for (const t of get().tabs) {
      void t.source?.dispose()
      void t.docSource?.dispose()
    }
    // Clear the active connection so connection-scoped polling (the server-stats
    // dashboard's refetchInterval hooks are enabled-gated on connId) stops
    // instead of looping forever against the now-dead db-host connection.
    useConnStore.getState().clearActive()
    set((s) => ({
      tabs: s.tabs.map((t) => ({
        ...t,
        source: undefined,
        docSource: undefined,
        status: 'error' as TabStatus,
        message: 'Connection lost — reconnect'
      }))
    }))
  }
}))

import { useEffect, useMemo, useRef, useState } from 'react'
import { Tree } from 'react-arborist'
import IconChevronRight from '~icons/lucide/chevron-right'
import IconChevronDown from '~icons/lucide/chevron-down'
import IconDatabase from '~icons/lucide/database'
import IconTable from '~icons/lucide/table'
import IconEye from '~icons/lucide/eye'
import IconColumn from '~icons/lucide/circle'
import IconFolder from '~icons/lucide/folder'
import IconBraces from '~icons/lucide/braces'
import IconZap from '~icons/lucide/zap'
import { useQuery } from '@tanstack/react-query'
import { useConnStore } from '../store'
import { useQueryStore } from '../store-query'
import { useProfiles } from '../query/profiles'
import { hostApi } from '../rpc'
import { buildDdl } from '@shared/ddl/build-ddl'
import {
  buildDropObject,
  functionTemplate,
  triggerTemplate,
  sequenceTemplate,
  matviewTemplate,
  refreshMatview
} from '@shared/ddl/object-ddl'
import { buildMaintenance, MAINTENANCE_LABELS, type MaintenanceOp } from '@shared/ddl/maintenance'
import type { DdlChange, SchemaOps } from '@shared/adapter/schema-types'
import type { ObjectKind } from '@shared/adapter/object-types'
import { TableInfoDialog } from './TableInfoDialog'
import { CreateTableDialog } from './CreateTableDialog'
import { CreateDatabaseDialog } from './CreateDatabaseDialog'
import { ObjectEditorDialog } from './ObjectEditorDialog'
import { CollectionIndexes } from './CollectionIndexes'
import { CollectionValidation } from './CollectionValidation'
import { queryClient } from '../query/client'
import { useSchemas, fetchTables, fetchColumns, fetchObjects } from '../query/introspection'
import { useDocumentQuerySupported } from '../query/documents'
import {
  buildTree,
  invalidatedNodeId,
  type CategoryKind,
  type TreeNode
} from '../query/schema-tree-model'

const CATEGORY_LABEL: Record<CategoryKind, string> = {
  table: 'Tables',
  view: 'Views',
  function: 'Functions',
  trigger: 'Triggers',
  sequence: 'Sequences',
  materializedView: 'Materialized Views'
}

// Friendly noun for menu labels ("Drop materialized view", not "materializedView").
const KIND_NOUN: Record<ObjectKind, string> = {
  view: 'view',
  function: 'function',
  trigger: 'trigger',
  sequence: 'sequence',
  materializedView: 'materialized view'
}

// Lazy tree: schemas come from React Query; a schema's tables load on first
// expand, a table's columns on first expand. Fetches go through the shared
// query cache (fetchTables/fetchColumns), so expanding here warms the SQL
// autocomplete and vice-versa. `childrenById` holds each expanded node's DIRECT
// children; buildTree resolves the nested tree so a table shows its columns as
// soon as they load. When introspection is invalidated (Refresh schema / DDL),
// a cache subscription re-fetches the affected already-loaded nodes so the
// visible tree stays in sync with the cache the autocomplete reads.
export function SchemaTree(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  const { data: schemas, isLoading, error } = useSchemas(connId)
  // Document-mode engines (MongoDB) show collections as "table" nodes too, but a
  // leaf click should open a document-query tab, not the relational data grid.
  const { data: docSupported = false } = useDocumentQuerySupported(connId)
  const [childrenById, setChildrenById] = useState<Record<string, TreeNode[]>>({})
  // Right-click context menu (table or schema node) + read-only table-info dialog.
  const [menu, setMenu] = useState<
    | {
        kind: 'table'
        x: number
        y: number
        schema: string
        table: string
        isView: boolean
        toggle: () => void
      }
    | { kind: 'schema'; x: number; y: number; schema: string }
    | { kind: 'object'; x: number; y: number; schema: string; objectKind: ObjectKind; name: string }
    | { kind: 'newview'; x: number; y: number; schema: string }
    | { kind: 'newobject'; x: number; y: number; schema: string; objectKind: ObjectKind }
    | null
  >(null)
  // Raw function/trigger editor (create/alter).
  const [objectEditor, setObjectEditor] = useState<{
    title: string
    initialSql: string
  } | null>(null)
  // Inline "New view" form (name + SELECT) — Electron has no window.prompt.
  const [newView, setNewView] = useState<{ schema: string } | null>(null)
  const [info, setInfo] = useState<{ schema: string; table: string } | null>(null)
  const [indexColl, setIndexColl] = useState<{ schema: string; table: string } | null>(null)
  const [validationColl, setValidationColl] = useState<{ schema: string; table: string } | null>(
    null
  )
  const [ddlError, setDdlError] = useState<string | null>(null)
  // Electron has no window.prompt, so name-entry (new table/schema/database) uses
  // an inline input rendered above the tree.
  const [namePrompt, setNamePrompt] = useState<{
    title: string
    onSubmit: (name: string) => void
  } | null>(null)
  const [createTable, setCreateTable] = useState<{ schema: string } | null>(null)
  const [createDatabase, setCreateDatabase] = useState(false)

  const profileId = useConnStore((s) => s.activeProfileId)
  const { data: profiles = [] } = useProfiles()
  const dialect: 'pg' | 'sqlite' =
    profiles.find((p) => p.id === profileId)?.engine === 'postgres' ? 'pg' : 'sqlite'
  const { data: ops } = useQuery({
    queryKey: connId ? ['conn', connId, 'schemaOps'] : ['conn', 'none', 'schemaOps'],
    queryFn: async (): Promise<SchemaOps | undefined> => {
      const api = await hostApi()
      return (await api.schemaEditSupported(connId!)) ? api.schemaOps(connId!) : undefined
    },
    enabled: !!connId
  })
  const { data: objectKinds = [] } = useQuery({
    queryKey: connId ? ['conn', connId, 'objectKinds'] : ['conn', 'none', 'objectKinds'],
    queryFn: async (): Promise<ObjectKind[]> => {
      const api = await hostApi()
      return (await api.objectsSupported(connId!)) ? api.objectKinds(connId!) : []
    },
    enabled: !!connId
  })

  // Build → preview (confirm) → apply. Store's applyDdl invalidates introspection.
  // Surface failures (permission denied, in-use database, syntax) instead of
  // dropping the rejection silently.
  async function runDdl(change: DdlChange | DdlChange[]): Promise<void> {
    const changes = Array.isArray(change) ? change : [change]
    const statements = changes.flatMap((c) => buildDdl(c, dialect))
    if (!statements.length) return
    if (!window.confirm(`Apply this DDL?\n\n${statements.join(';\n')}`)) return
    setDdlError(null)
    try {
      await useQueryStore.getState().applyDdl(statements)
    } catch (err) {
      setDdlError(err instanceof Error ? err.message : String(err))
    }
  }

  // Run raw DDL (a function/trigger definition or drop) — the editor/confirm is
  // the review, so no extra window.confirm here.
  async function applyRawDdl(sql: string): Promise<void> {
    setDdlError(null)
    try {
      await useQueryStore.getState().applyDdl([sql])
    } catch (err) {
      setDdlError(err instanceof Error ? err.message : String(err))
    }
  }

  // MongoDB collection admin (create/drop/rename) — no SQL, so it calls the
  // DocumentAdmin capability directly, then invalidates the connection so the
  // tree's expanded schema node reloads its collections.
  async function collectionOp(op: () => Promise<void>): Promise<void> {
    setDdlError(null)
    try {
      await op()
      await queryClient.invalidateQueries({ queryKey: ['conn', connId] })
    } catch (err) {
      setDdlError(err instanceof Error ? err.message : String(err))
    }
  }

  // Table maintenance (VACUUM/ANALYZE/REINDEX) — VACUUM can't run in a
  // transaction, so it goes through executeQuery (autocommit), not applyDdl.
  async function runMaintenance(op: MaintenanceOp, schema: string, table: string): Promise<void> {
    const sql = buildMaintenance(op, schema, table)
    if (!window.confirm(`Run maintenance?\n\n${sql}`)) return
    setDdlError(null)
    try {
      await (await hostApi()).executeQuery(connId!, sql)
    } catch (err) {
      setDdlError(err instanceof Error ? err.message : String(err))
    }
  }

  function openNewObject(schema: string, objectKind: ObjectKind): void {
    const template =
      objectKind === 'function'
        ? functionTemplate(schema)
        : objectKind === 'sequence'
          ? sequenceTemplate(schema)
          : objectKind === 'materializedView'
            ? matviewTemplate(schema)
            : triggerTemplate(schema)
    setObjectEditor({ title: `New ${KIND_NOUN[objectKind]}`, initialSql: template })
  }

  async function refreshMatviewObject(schema: string, name: string): Promise<void> {
    const sql = refreshMatview(schema, name)
    if (!window.confirm(`Apply this DDL?\n\n${sql}`)) return
    await applyRawDdl(sql)
  }

  async function openEditObject(schema: string, kind: ObjectKind, name: string): Promise<void> {
    const def = await (await hostApi()).objectDefinition(connId!, schema, kind, name)
    setObjectEditor({ title: `Edit ${kind} ${name}`, initialSql: def })
  }

  async function dropObject(schema: string, kind: ObjectKind, name: string): Promise<void> {
    // Triggers need their table, which lives in the definition — fetch it first.
    const def =
      kind === 'trigger'
        ? await (
            await hostApi()
          )
            .objectDefinition(connId!, schema, kind, name)
            .catch(() => undefined)
        : undefined
    const sql = buildDropObject(kind, schema, name, def)
    if (!window.confirm(`Apply this DDL?\n\n${sql}`)) return
    await applyRawDdl(sql)
  }

  function menuItems(m: NonNullable<typeof menu>): { label: string; run: () => void }[] {
    if (m.kind === 'object') {
      const items: { label: string; run: () => void }[] = [
        {
          label: 'Definition',
          run: () => useQueryStore.getState().openObjectDefinition(m.schema, m.objectKind, m.name)
        }
      ]
      if (m.objectKind === 'view')
        items.push({
          label: 'Drop view',
          // Preview the generated DROP VIEW (runDdl confirms the SQL), like every
          // other DDL action.
          run: () => void runDdl({ kind: 'dropView', schema: m.schema, name: m.name })
        })
      if (m.objectKind === 'function' || m.objectKind === 'trigger') {
        items.push({
          label: 'Edit definition…',
          run: () => void openEditObject(m.schema, m.objectKind, m.name)
        })
      }
      if (m.objectKind === 'materializedView')
        items.push({
          label: 'Refresh',
          run: () => void refreshMatviewObject(m.schema, m.name)
        })
      if (m.objectKind !== 'view') {
        // View has its own preview-gated Drop above; every other kind drops here.
        items.push({
          label: `Drop ${KIND_NOUN[m.objectKind]}`,
          run: () => void dropObject(m.schema, m.objectKind, m.name)
        })
      }
      return items
    }
    if (m.kind === 'newobject') {
      return [
        {
          label: `New ${m.objectKind}…`,
          run: () => openNewObject(m.schema, m.objectKind)
        }
      ]
    }
    if (m.kind === 'newview') {
      return [{ label: 'New view…', run: () => setNewView({ schema: m.schema }) }]
    }
    if (m.kind === 'table') {
      return [
        // Document-mode connections (Mongo) open collections via the primary
        // click into a document-query tab; the relational "Open data" path
        // dead-ends there (openBrowse isn't supported), so hide it.
        ...(docSupported
          ? []
          : [
              {
                label: 'Open data',
                run: () => void useQueryStore.getState().openTable(m.schema, m.table)
              }
            ]),
        // Structure reconstructs a CREATE TABLE, which is nonsensical for a
        // document-mode (Mongo) collection — relational-only, gate on docSupported.
        ...(docSupported
          ? []
          : [
              {
                label: 'Structure',
                run: () => useQueryStore.getState().openStructure(m.schema, m.table)
              }
            ]),
        { label: 'Show columns', run: () => m.toggle() },
        { label: 'Table info', run: () => setInfo({ schema: m.schema, table: m.table }) },
        // Mongo collections: manage indexes (relational engines use Structure)
        // and administer the collection itself.
        ...(docSupported
          ? [
              {
                label: 'Indexes…',
                run: () => setIndexColl({ schema: m.schema, table: m.table })
              },
              {
                label: 'Validation…',
                run: () => setValidationColl({ schema: m.schema, table: m.table })
              },
              {
                label: 'Rename collection…',
                run: () =>
                  setNamePrompt({
                    title: `Rename ${m.table} to`,
                    onSubmit: (to) =>
                      void collectionOp(async () =>
                        (await hostApi()).renameCollection(connId!, m.schema, m.table, to)
                      )
                  })
              },
              {
                label: 'Drop collection',
                run: () => {
                  if (!window.confirm(`Drop collection ${m.schema}.${m.table}?`)) return
                  void collectionOp(async () =>
                    (await hostApi()).dropCollection(connId!, m.schema, m.table)
                  )
                }
              }
            ]
          : []),
        // Export/CSV-import reconstruct a CREATE TABLE + rows — only meaningful for
        // real (relational) tables, not views, and not Mongo collections.
        ...(m.isView || docSupported
          ? []
          : [
              {
                label: 'Export (SQL)',
                run: () =>
                  void useQueryStore
                    .getState()
                    .exportSql({ kind: 'table', schema: m.schema, table: m.table }, false, dialect)
              },
              {
                label: 'Export (SQL, gzip)',
                run: () =>
                  void useQueryStore
                    .getState()
                    .exportSql({ kind: 'table', schema: m.schema, table: m.table }, true, dialect)
              },
              {
                label: 'Import CSV…',
                run: () => void useQueryStore.getState().beginCsvImport(m.schema, m.table)
              }
            ]),
        {
          label: 'Copy name',
          run: () => void navigator.clipboard.writeText(`"${m.schema}"."${m.table}"`)
        },
        // Maintenance is Postgres-only and meaningless for a view.
        ...(dialect === 'pg' && !m.isView && !docSupported
          ? MAINTENANCE_LABELS.map(({ op, label }) => ({
              label,
              run: () => void runMaintenance(op, m.schema, m.table)
            }))
          : [])
      ]
    }
    // Schema node — DDL entries gated on the engine's advertised ops.
    const items: { label: string; run: () => void }[] = []
    if (ops?.createTable)
      items.push({
        label: 'New table…',
        run: () => setCreateTable({ schema: m.schema })
      })
    // Mongo database node: create a collection (no relational createTable op).
    if (docSupported)
      items.push({
        label: 'New collection…',
        run: () =>
          setNamePrompt({
            title: `New collection in ${m.schema}`,
            onSubmit: (name) =>
              void collectionOp(async () =>
                (await hostApi()).createCollection(connId!, m.schema, name)
              )
          })
      })
    if (ops?.createSchema)
      items.push({
        label: 'New schema…',
        run: () =>
          setNamePrompt({
            title: 'New schema name',
            onSubmit: (name) => void runDdl({ kind: 'createSchema', name })
          })
      })
    if (ops?.dropSchema)
      items.push({
        label: 'Drop schema',
        run: () => void runDdl({ kind: 'dropSchema', name: m.schema })
      })
    if (ops?.createDatabase)
      items.push({
        label: 'New database…',
        run: () => setCreateDatabase(true)
      })
    if (ops?.dropDatabase)
      items.push({
        label: 'Drop database…',
        run: () =>
          setNamePrompt({
            title: 'Database to drop',
            onSubmit: (name) => void runDdl({ kind: 'dropDatabase', name })
          })
      })
    // Relational-only (reconstructs a SQL dump) — hide on a Mongo (document-mode)
    // connection.
    if (!docSupported)
      items.push({
        label: 'Export database (SQL)',
        run: () =>
          void useQueryStore
            .getState()
            .exportSql({ kind: 'database', schema: m.schema }, false, dialect)
      })
    return items
  }

  // Reset loaded children synchronously when the connection changes, so a prior
  // connection's tables/columns can never pair with a new connection's schemas
  // (not even for one frame).
  const [prevConn, setPrevConn] = useState(connId)
  if (prevConn !== connId) {
    setPrevConn(connId)
    setChildrenById({})
  }

  // Latest snapshots for the (connId-scoped) cache subscription without making
  // them subscription dependencies. objectKindsRef matters: the subscription's
  // loadChildren closure would otherwise capture the pre-fetch empty kinds and
  // rebuild a schema WITHOUT its category folders on the next DDL reload.
  const childrenRef = useRef(childrenById)
  childrenRef.current = childrenById
  const objectKindsRef = useRef(objectKinds)
  objectKindsRef.current = objectKinds

  async function loadChildren(id: string): Promise<void> {
    if (!connId) return
    let kids: TreeNode[]
    if (id.startsWith('s:')) {
      // schema → table nodes directly (common path, no extra click), plus a
      // category folder for each object kind the engine exposes.
      const schema = id.slice(2)
      const tables = await fetchTables(queryClient, connId, schema)
      const tableNodes: TreeNode[] = tables
        .filter((t) => t.type === 'table')
        .map((t) => ({
          id: `t:${schema}.${t.name}`,
          name: t.name,
          kind: 'table' as const,
          schema,
          table: t.name
        }))
      const catNodes: TreeNode[] = objectKindsRef.current.map((k) => ({
        id: `cat:${schema}.${k}`,
        name: CATEGORY_LABEL[k],
        kind: 'category' as const,
        schema,
        category: k
      }))
      kids = [...tableNodes, ...catNodes]
    } else if (id.startsWith('cat:')) {
      const rest = id.slice(4)
      const dot = rest.lastIndexOf('.')
      const schema = rest.slice(0, dot)
      const cat = rest.slice(dot + 1) as CategoryKind
      const objs = await fetchObjects(queryClient, connId, schema, cat as ObjectKind)
      kids = objs.map((o) => ({
        id: `obj:${schema}.${cat}.${o.name}`,
        name: o.name,
        kind: cat,
        schema
      }))
    } else if (id.startsWith('t:')) {
      // t:<schema>.<table> → columns.
      const rest = id.slice(2)
      const dot = rest.indexOf('.')
      const schema = rest.slice(0, dot)
      const table = rest.slice(dot + 1)
      const cols = await fetchColumns(queryClient, connId, schema, table)
      kids = cols.map((c) => ({
        id: `c:${schema}.${table}.${c.name}`,
        name: c.name,
        kind: 'column' as const,
        schema,
        table
      }))
    } else {
      // Leaf ids (obj:/c:) have no children — never load.
      return
    }
    setChildrenById((prev) => ({ ...prev, [id]: kids }))
  }

  // Re-fetch a loaded node's children when its introspection query is
  // invalidated (Refresh schema button/command, or DDL after a non-SELECT).
  useEffect(() => {
    if (!connId) return
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'invalidate') return
      const key = event.query.queryKey as readonly unknown[]
      if (key[0] !== 'conn' || key[1] !== connId) return
      const id = invalidatedNodeId(key)
      if (id && childrenRef.current[id]) void loadChildren(id)
    })
    // loadChildren closes over connId; re-subscribe when the connection changes.
  }, [connId])

  function onToggle(id: string): void {
    // Leaf nodes (columns c:, objects obj:) never load children; guard re-fetch.
    if (!connId || id.startsWith('c:') || id.startsWith('obj:') || childrenById[id]) return
    void loadChildren(id)
  }

  const data = useMemo(() => buildTree(schemas ?? [], childrenById), [schemas, childrenById])

  if (error)
    return (
      <div className="p-4 text-destructive">
        Schema load failed: {error instanceof Error ? error.message : String(error)}
      </div>
    )
  if (isLoading) return <div className="p-4 text-muted-foreground">Loading schemas…</div>

  return (
    <div className="p-2">
      {ddlError && (
        <div className="mb-1 flex items-start gap-2 rounded bg-destructive/10 p-1 text-xs text-destructive">
          <span className="min-w-0 flex-1 break-words">DDL failed: {ddlError}</span>
          <button className="shrink-0 hover:underline" onClick={() => setDdlError(null)}>
            dismiss
          </button>
        </div>
      )}
      {namePrompt && <NamePrompt prompt={namePrompt} onClose={() => setNamePrompt(null)} />}
      {createTable && (
        <CreateTableDialog
          open
          onClose={() => setCreateTable(null)}
          connId={connId!}
          schema={createTable.schema}
          dialect={dialect}
          onSubmit={(change) => void runDdl(change)}
        />
      )}
      {createDatabase && (
        <CreateDatabaseDialog
          open
          onClose={() => setCreateDatabase(false)}
          connId={connId!}
          onSubmit={(change) => void runDdl(change)}
        />
      )}
      <ObjectEditorDialog
        open={objectEditor !== null}
        onClose={() => setObjectEditor(null)}
        title={objectEditor?.title ?? ''}
        initialSql={objectEditor?.initialSql ?? ''}
        onApply={(sql) => {
          setObjectEditor(null)
          void applyRawDdl(sql)
        }}
      />
      {newView && (
        <NewViewForm
          onCancel={() => setNewView(null)}
          onSubmit={(name, select) => {
            setNewView(null)
            // runDdl shows the generated CREATE VIEW in a confirm before applying.
            void runDdl({ kind: 'createView', schema: newView.schema, name, select })
          }}
        />
      )}
      <Tree
        data={data}
        openByDefault={false}
        width={400}
        height={600}
        indent={16}
        rowHeight={24}
        onToggle={onToggle}
      >
        {({ node, style, dragHandle }) => {
          const kind = node.data.kind
          const isColumn = kind === 'column'
          const isObject = kind === 'view' || kind === 'function' || kind === 'trigger'
          const TypeIcon =
            kind === 'schema'
              ? IconDatabase
              : kind === 'category'
                ? IconFolder
                : kind === 'view'
                  ? IconEye
                  : kind === 'function'
                    ? IconBraces
                    : kind === 'trigger'
                      ? IconZap
                      : isColumn
                        ? IconColumn
                        : IconTable
          return (
            <div
              style={style}
              ref={dragHandle}
              // Primary click: a table opens its data tab; an object (view/function/
              // trigger) opens its definition; schema/category toggle their children.
              onClick={() => {
                if (kind === 'table') {
                  if (docSupported)
                    void useQueryStore.getState().openCollection(node.data.schema, node.data.name)
                  else void useQueryStore.getState().openTable(node.data.schema, node.data.name)
                } else if (isObject)
                  useQueryStore
                    .getState()
                    .openObjectDefinition(node.data.schema, kind as ObjectKind, node.data.name)
                else if (!isColumn) node.toggle()
              }}
              onContextMenu={(e) => {
                if (kind === 'table') {
                  e.preventDefault()
                  setMenu({
                    kind: 'table',
                    x: e.clientX,
                    y: e.clientY,
                    schema: node.data.schema,
                    table: node.data.name,
                    isView: false,
                    toggle: () => node.toggle()
                  })
                } else if (isObject) {
                  e.preventDefault()
                  setMenu({
                    kind: 'object',
                    x: e.clientX,
                    y: e.clientY,
                    schema: node.data.schema,
                    objectKind: kind as ObjectKind,
                    name: node.data.name
                  })
                } else if (kind === 'category' && node.data.category === 'view') {
                  e.preventDefault()
                  setMenu({ kind: 'newview', x: e.clientX, y: e.clientY, schema: node.data.schema })
                } else if (
                  kind === 'category' &&
                  (node.data.category === 'function' || node.data.category === 'trigger')
                ) {
                  e.preventDefault()
                  setMenu({
                    kind: 'newobject',
                    x: e.clientX,
                    y: e.clientY,
                    schema: node.data.schema,
                    objectKind: node.data.category
                  })
                } else if (kind === 'schema') {
                  e.preventDefault()
                  setMenu({ kind: 'schema', x: e.clientX, y: e.clientY, schema: node.data.name })
                }
              }}
              className={`flex items-center gap-1 rounded px-1 text-sm ${
                isColumn ? 'cursor-default' : 'cursor-pointer hover:bg-surface-2'
              }`}
            >
              <span
                className="w-3.5 shrink-0 text-muted-foreground"
                // Chevron toggles expand/collapse (columns for a table) without
                // triggering the row's open action. Objects/columns are leaves —
                // no chevron.
                onClick={(e) => {
                  if (isColumn || isObject) return
                  e.stopPropagation()
                  node.toggle()
                }}
              >
                {!isColumn &&
                  !isObject &&
                  (node.isOpen ? (
                    <IconChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <IconChevronRight className="h-3.5 w-3.5" />
                  ))}
              </span>
              <TypeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {/* Category folders read as 11px uppercase section headers (Dialect). */}
              {kind === 'category' ? (
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {node.data.name}
                </span>
              ) : (
                <span className="text-foreground">{node.data.name}</span>
              )}
            </div>
          )
        }}
      </Tree>

      {menu && (
        <>
          {/* Click-away backdrop. */}
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div
            className="fixed z-50 min-w-40 rounded border border-border bg-background py-1 text-sm shadow-md"
            style={{ left: menu.x, top: menu.y }}
          >
            {menuItems(menu).map((item) => (
              <button
                key={item.label}
                className="block w-full px-3 py-1 text-left text-foreground hover:bg-muted"
                onClick={() => {
                  item.run()
                  setMenu(null)
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}

      {info && (
        <TableInfoDialog schema={info.schema} table={info.table} onClose={() => setInfo(null)} />
      )}

      {indexColl && connId && (
        <CollectionIndexes
          connId={connId}
          db={indexColl.schema}
          coll={indexColl.table}
          onClose={() => setIndexColl(null)}
        />
      )}

      {validationColl && connId && (
        <CollectionValidation
          connId={connId}
          db={validationColl.schema}
          coll={validationColl.table}
          onClose={() => setValidationColl(null)}
        />
      )}
    </div>
  )
}

function NamePrompt(props: {
  prompt: { title: string; onSubmit: (name: string) => void }
  onClose: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const submit = (): void => {
    const n = name.trim()
    if (n) props.prompt.onSubmit(n)
    props.onClose()
  }
  return (
    <div className="mb-1 flex items-center gap-1 rounded border border-border p-1 text-xs">
      <span className="text-muted-foreground">{props.prompt.title}</span>
      <input
        aria-label="name-prompt-input"
        autoFocus
        className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') props.onClose()
        }}
      />
      <button className="rounded bg-primary px-2 py-0.5 text-primary-foreground" onClick={submit}>
        OK
      </button>
      <button className="rounded px-2 py-0.5 hover:bg-muted" onClick={props.onClose}>
        Cancel
      </button>
    </div>
  )
}

function NewViewForm(props: {
  onSubmit: (name: string, select: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [select, setSelect] = useState('')
  return (
    <div className="mb-1 flex flex-col gap-1 rounded border border-border p-1 text-xs">
      <span className="text-muted-foreground">New view</span>
      <input
        aria-label="view-name-input"
        autoFocus
        className="rounded border border-border bg-background px-1 py-0.5"
        placeholder="view name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        aria-label="view-select-input"
        className="h-16 rounded border border-border bg-background px-1 py-0.5 font-mono"
        placeholder="SELECT …"
        value={select}
        onChange={(e) => setSelect(e.target.value)}
      />
      <div className="flex justify-end gap-1">
        <button className="rounded px-2 py-0.5 hover:bg-muted" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          className="rounded bg-primary px-2 py-0.5 text-primary-foreground disabled:opacity-50"
          disabled={!name.trim() || !select.trim()}
          onClick={() => props.onSubmit(name.trim(), select.trim())}
        >
          Create
        </button>
      </div>
    </div>
  )
}

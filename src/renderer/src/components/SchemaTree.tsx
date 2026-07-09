import { useEffect, useMemo, useRef, useState } from 'react'
import { Tree } from 'react-arborist'
import IconChevronRight from '~icons/lucide/chevron-right'
import IconChevronDown from '~icons/lucide/chevron-down'
import IconDatabase from '~icons/lucide/database'
import IconTable from '~icons/lucide/table'
import IconEye from '~icons/lucide/eye'
import IconColumn from '~icons/lucide/circle'
import { useConnStore } from '../store'
import { queryClient } from '../query/client'
import { useSchemas, fetchTables, fetchColumns } from '../query/introspection'
import { buildTree, invalidatedNodeId, type TreeNode } from '../query/schema-tree-model'

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
  const [childrenById, setChildrenById] = useState<Record<string, TreeNode[]>>({})

  // Reset loaded children synchronously when the connection changes, so a prior
  // connection's tables/columns can never pair with a new connection's schemas
  // (not even for one frame).
  const [prevConn, setPrevConn] = useState(connId)
  if (prevConn !== connId) {
    setPrevConn(connId)
    setChildrenById({})
  }

  // Latest snapshot for the (connId-scoped) cache subscription without making it
  // a subscription dependency.
  const childrenRef = useRef(childrenById)
  childrenRef.current = childrenById

  async function loadChildren(id: string): Promise<void> {
    if (!connId) return
    let kids: TreeNode[]
    if (id.startsWith('s:')) {
      const schema = id.slice(2)
      const tables = await fetchTables(queryClient, connId, schema)
      kids = tables.map((t) => ({
        id: `t:${schema}.${t.name}`,
        name: t.name,
        kind: t.type,
        schema,
        table: t.name
      }))
    } else {
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
    // Column nodes are leaves; guard against re-fetch on collapse/re-expand.
    if (!connId || id.startsWith('c:') || childrenById[id]) return
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
          const TypeIcon =
            kind === 'schema'
              ? IconDatabase
              : kind === 'view'
                ? IconEye
                : isColumn
                  ? IconColumn
                  : IconTable
          return (
            <div
              style={style}
              ref={dragHandle}
              // react-arborist doesn't toggle on row click by default; wire it
              // so clicking a schema/table row expands or collapses it. Columns
              // are leaves.
              onClick={() => {
                if (!isColumn) node.toggle()
              }}
              className={`flex items-center gap-1 text-sm ${isColumn ? 'cursor-default' : 'cursor-pointer'}`}
            >
              <span className="w-3.5 shrink-0 text-muted-foreground">
                {!isColumn &&
                  (node.isOpen ? (
                    <IconChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <IconChevronRight className="h-3.5 w-3.5" />
                  ))}
              </span>
              <TypeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-foreground">{node.data.name}</span>
            </div>
          )
        }}
      </Tree>
    </div>
  )
}

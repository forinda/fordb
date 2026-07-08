import { useEffect, useMemo, useState } from 'react'
import { Tree } from 'react-arborist'
import { useConnStore } from '../store'
import { queryClient } from '../query/client'
import { useSchemas, fetchTables, fetchColumns } from '../query/introspection'

interface Node {
  id: string
  name: string
  kind: 'schema' | 'table' | 'view' | 'column'
  schema: string
  table?: string
  children?: Node[]
}

// Lazy tree: schemas come from React Query; a schema's tables are fetched on
// first expand, a table's columns on first expand. Fetches go through the
// shared query cache (fetchTables/fetchColumns), so expanding a table here
// warms the SQL autocomplete and vice-versa. `childrenById` holds whatever has
// been loaded; an unloaded parent renders with an empty `children` array so
// react-arborist shows it as expandable.
export function SchemaTree(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  const { data: schemas, isLoading, error } = useSchemas(connId)
  const [childrenById, setChildrenById] = useState<Record<string, Node[]>>({})

  // Drop loaded children when the connection changes so a prior connection's
  // tables/columns can't linger.
  useEffect(() => {
    setChildrenById({})
  }, [connId])

  const data: Node[] = useMemo(
    () =>
      (schemas ?? []).map((s) => ({
        id: `s:${s}`,
        name: s,
        kind: 'schema' as const,
        schema: s,
        children: childrenById[`s:${s}`] ?? []
      })),
    [schemas, childrenById]
  )

  async function onToggle(id: string): Promise<void> {
    if (!connId || childrenById[id]) return // already loaded (or nothing to load)
    if (id.startsWith('s:')) {
      const schema = id.slice(2)
      const tables = await fetchTables(queryClient, connId, schema)
      setChildrenById((prev) => ({
        ...prev,
        [id]: tables.map((t) => ({
          id: `t:${schema}.${t.name}`,
          name: t.name,
          kind: t.type,
          schema,
          table: t.name,
          children: prev[`t:${schema}.${t.name}`] ?? []
        }))
      }))
    } else if (id.startsWith('t:')) {
      const rest = id.slice(2)
      const dot = rest.indexOf('.')
      const schema = rest.slice(0, dot)
      const table = rest.slice(dot + 1)
      const cols = await fetchColumns(queryClient, connId, schema, table)
      setChildrenById((prev) => ({
        ...prev,
        [id]: cols.map((c) => ({
          id: `c:${schema}.${table}.${c.name}`,
          name: c.name,
          kind: 'column' as const,
          schema,
          table
        }))
      }))
    }
  }

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
        onToggle={(id) => void onToggle(id)}
      >
        {({ node, style, dragHandle }) => (
          <div
            style={style}
            ref={dragHandle}
            className="flex items-center gap-1 text-sm cursor-default"
          >
            <span className="text-muted-foreground">
              {node.data.kind === 'schema'
                ? '▸'
                : node.data.kind === 'view'
                  ? '◇'
                  : node.data.kind === 'column'
                    ? '·'
                    : '▪'}
            </span>
            <span className="text-foreground">{node.data.name}</span>
          </div>
        )}
      </Tree>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Tree } from 'react-arborist'
import { useConnStore } from '../store'
import { hostApi } from '../rpc'

interface Node {
  id: string
  name: string
  kind: 'schema' | 'table' | 'view'
  children?: Node[]
}

export function SchemaTree(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  const [nodes, setNodes] = useState<Node[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!connId) return
    let cancelled = false
    void (async () => {
      try {
        const api = await hostApi()
        const schemas = await api.listSchemas(connId)
        const built = await Promise.all(
          schemas.map(async (schema) => {
            const tables = await api.listTables(connId, schema)
            return {
              id: `s:${schema}`,
              name: schema,
              kind: 'schema' as const,
              children: tables.map((t) => ({
                id: `t:${schema}.${t.name}`,
                name: t.name,
                kind: t.type
              }))
            }
          })
        )
        if (!cancelled) setNodes(built)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connId])

  if (error) return <div className="p-4 text-red-400">Schema load failed: {error}</div>
  return (
    <div className="p-2">
      <Tree data={nodes} openByDefault={false} width={400} height={600} indent={16} rowHeight={24}>
        {({ node, style, dragHandle }) => (
          <div
            style={style}
            ref={dragHandle}
            className="flex items-center gap-1 text-sm cursor-default"
          >
            <span className="text-neutral-500">
              {node.data.kind === 'schema' ? '▸' : node.data.kind === 'view' ? '◇' : '▪'}
            </span>
            <span>{node.data.name}</span>
          </div>
        )}
      </Tree>
    </div>
  )
}

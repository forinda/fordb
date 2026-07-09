import { useQuery } from '@tanstack/react-query'
import { useConnStore } from '../store'
import { hostApi } from '../rpc'
import { qk } from '../query/keys'
import type { QueryTab } from '../store-query'

/** Read-only definition of a view/function/trigger (mirrors ExplainView). */
export function ObjectDefinitionView(props: { tab: QueryTab }): React.JSX.Element {
  const { schema, kind, name } = props.tab.object ?? { schema: '', kind: 'view', name: '' }
  const connId = useConnStore((s) => s.activeConnectionId)
  const { data, isLoading, error } = useQuery({
    queryKey: connId
      ? [...qk.objects(connId, schema, kind), 'def', name]
      : ['conn', 'none', 'objectdef'],
    queryFn: async () => (await hostApi()).objectDefinition(connId!, schema, kind, name),
    enabled: !!connId
  })
  return (
    <div className="flex h-full flex-col overflow-auto p-3 text-sm">
      <div className="mb-2 text-muted-foreground">
        {schema}.{name} <span className="text-xs">({kind})</span>
      </div>
      {error ? (
        <div className="rounded bg-destructive/10 p-2 text-destructive">
          {error instanceof Error ? error.message : String(error)}
        </div>
      ) : (
        <pre className="overflow-x-auto rounded bg-muted/40 p-2 font-mono text-xs">
          {isLoading ? 'loading…' : data || '(no definition)'}
        </pre>
      )}
    </div>
  )
}

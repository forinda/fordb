import { useConnStore } from '../store'
import { queryClient } from '../query/client'
import { invalidateIntrospection } from '../query/introspection'
import { Button } from './ui/button'

export function RefreshSchemaButton(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={!connId}
      onClick={() => {
        if (connId) void invalidateIntrospection(queryClient, connId)
      }}
    >
      Refresh schema
    </Button>
  )
}

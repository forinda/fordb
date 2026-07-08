import { useEffect, useState } from 'react'
import { createRpcClient } from '../../shared/rpc/client'
import type { DbAdapter } from '../../shared/adapter/db-adapter'
import type { PortLike } from '../../shared/rpc/protocol'

declare global {
  interface Window {
    fordb: { getDbHostPort: () => Promise<PortLike> }
  }
}

export function App(): React.JSX.Element {
  const [status, setStatus] = useState('starting…')
  useEffect(() => {
    void window.fordb.getDbHostPort().then((port) => {
      const adapter = createRpcClient<DbAdapter>(port)
      // Proves RPC wiring end-to-end; errors expectedly if no local Postgres.
      adapter
        .listDatabases()
        .then((dbs) => setStatus(`databases: ${dbs.join(', ')}`))
        .catch((err: Error) => setStatus(`db-host reachable, connect error: ${err.message}`))
    })
  }, [])
  return <h1>fordb — {status}</h1>
}

import { useEffect, useState } from 'react'

declare global {
  interface Window {
    fordb: { getDbHostPort: () => Promise<MessagePort> }
  }
}

export function App(): React.JSX.Element {
  const [status, setStatus] = useState('connecting to db-host…')
  useEffect(() => {
    void window.fordb.getDbHostPort().then((port) => {
      port.onmessage = (e): void => {
        if ((e.data as { type?: string }).type === 'pong') setStatus('db-host: pong')
      }
      port.postMessage({ type: 'ping' })
    })
  }, [])
  return <h1>fordb — {status}</h1>
}

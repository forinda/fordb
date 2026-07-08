import { serveRpc } from '../shared/rpc/server'
import type { PortLike } from '../shared/rpc/protocol'
import { PostgresAdapter } from './postgres/postgres-adapter'

function electronPort(port: Electron.MessagePortMain): PortLike {
  return {
    postMessage: (msg) => port.postMessage(msg),
    onMessage: (cb) => port.on('message', (e) => cb(e.data))
  }
}

process.parentPort.on('message', (e) => {
  const [port] = e.ports
  if (!port) return
  // One adapter instance per renderer client; M2 adds a connection registry.
  serveRpc(electronPort(port), new PostgresAdapter())
  port.start()
})

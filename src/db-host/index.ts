import { serveRpc } from '../shared/rpc/server'
import type { PortLike } from '../shared/rpc/protocol'
import { PostgresAdapter } from './postgres/postgres-adapter'

function electronPort(port: Electron.MessagePortMain): PortLike {
  return {
    postMessage: (msg) => port.postMessage(msg),
    onMessage: (cb) => port.on('message', (e) => cb(e.data)),
    onClose: (cb) => port.on('close', cb)
  }
}

process.parentPort.on('message', (e) => {
  const [port] = e.ports
  if (!port) return
  // One adapter instance per renderer client; M2 adds a connection registry.
  const adapter = new PostgresAdapter()
  serveRpc(electronPort(port), adapter)
  // Free the pg connection when the renderer's port closes (e.g. on reload),
  // instead of leaking it until process exit. Swallow disconnect errors: a
  // rejecting client.end() here would otherwise be an unhandled rejection that
  // can crash the db-host process on the reload this cleanup exists to handle.
  port.on('close', () => {
    void adapter.disconnect().catch(() => undefined)
  })
  port.start()
})

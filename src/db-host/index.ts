import { serveRpc } from '@shared/rpc/server'
import type { PortLike } from '@shared/rpc/protocol'
import { ConnectionRegistry } from './connection-registry'
import { HostApiImpl } from './host-api-impl'
import { PostgresAdapter } from './postgres/postgres-adapter'

let idCounter = 0
const registry = new ConnectionRegistry(
  () => new PostgresAdapter(),
  () => `conn-${process.pid}-${++idCounter}`
)

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
  // Every port (main's control port and each renderer port) gets its own
  // HostApi facade, all backed by the one process-wide registry.
  serveRpc(electronPort(port), new HostApiImpl(registry))
  port.start()
})

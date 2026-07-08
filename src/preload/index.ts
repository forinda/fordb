import { contextBridge, ipcRenderer } from 'electron'
import type { PortLike } from '../shared/rpc/protocol'

// contextBridge clones plain values across the isolated-world/main-world
// boundary but does not preserve MessagePort identity/methods (Electron
// only supports transferring a MessagePort into the main world via
// window.postMessage with a transfer list, received by a listener already
// running in that world — see the "MessagePorts" tutorial). Since
// contextBridge DOES proxy functions across the boundary, we build the
// PortLike wrapper here, in the preload's isolated world (where the real
// MessagePort lives), and hand the renderer only its `postMessage`/
// `onMessage` functions.
contextBridge.exposeInMainWorld('fordb', {
  getDbHostPort: (): Promise<PortLike> =>
    new Promise((resolve) => {
      ipcRenderer.once('db-host:port', (event) => {
        const port = event.ports[0]
        if (!port) return
        const portLike: PortLike = {
          postMessage: (msg) => port.postMessage(msg),
          // Assigning `onmessage` implicitly starts the MessagePort.
          onMessage: (cb) => (port.onmessage = (e): void => cb(e.data))
        }
        resolve(portLike)
      })
      void ipcRenderer.invoke('db-host:request-port')
    })
})

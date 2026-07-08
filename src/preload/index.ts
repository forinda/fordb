import { contextBridge, ipcRenderer } from 'electron'
import type { PortLike } from '../shared/rpc/protocol'
import type { ConnectionProfile } from '../shared/adapter/types'

// contextBridge clones plain values across the isolated-world/main-world
// boundary but does not preserve MessagePort identity/methods (Electron
// only supports transferring a MessagePort into the main world via
// window.postMessage with a transfer list, received by a listener already
// running in that world — see the "MessagePorts" tutorial). Since
// contextBridge DOES proxy functions across the boundary, we build the
// PortLike wrapper here, in the preload's isolated world (where the real
// MessagePort lives), and hand the renderer only its `postMessage`/
// `onMessage` functions.
function getDbHostPort(): Promise<PortLike> {
  return new Promise((resolve) => {
    ipcRenderer.once('db-host:port', (event) => {
      const port = event.ports[0]
      if (!port) return
      port.start()
      resolve({
        postMessage: (msg) => port.postMessage(msg),
        onMessage: (cb) => {
          port.onmessage = (e): void => cb(e.data)
        }
        // No onClose: the standard browser MessagePort has no 'close' event
        // (that only exists on Node's worker_threads MessagePort and
        // Electron's MessagePortMain). We deliberately leave onClose
        // undefined here rather than fabricate a close signal — the
        // renderer client simply won't get pending-call rejection on
        // teardown via this transport. If a real signal is needed later
        // (e.g. the host process exiting), it should be layered on top via
        // an explicit IPC message, not invented here.
      })
    })
    void ipcRenderer.invoke('db-host:request-port')
  })
}

contextBridge.exposeInMainWorld('fordb', {
  getDbHostPort,
  profiles: {
    list: (): Promise<ConnectionProfile[]> => ipcRenderer.invoke('profiles:list'),
    save: (
      p: ConnectionProfile,
      secrets: { password?: string; sshPassword?: string; sshPassphrase?: string }
    ): Promise<void> => ipcRenderer.invoke('profiles:save', p, secrets),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('profiles:delete', id)
  },
  connection: {
    test: (profileId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('connection:test', profileId),
    open: (profileId: string): Promise<string> => ipcRenderer.invoke('connection:open', profileId),
    close: (connectionId: string): Promise<void> =>
      ipcRenderer.invoke('connection:close', connectionId)
  }
})

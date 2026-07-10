import { contextBridge, ipcRenderer } from 'electron'
import type { PortLike } from '@shared/rpc/protocol'
import type { ConnectionProfile } from '@shared/adapter/types'
import type { HistoryEntry, SavedQuery } from '@shared/query/library-types'

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
      secrets: {
        password?: string
        sshPassword?: string
        sshPassphrase?: string
        authToken?: string
        uri?: string
      }
    ): Promise<void> => ipcRenderer.invoke('profiles:save', p, secrets),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('profiles:delete', id)
  },
  queries: {
    historyList: (profileId: string): Promise<HistoryEntry[]> =>
      ipcRenderer.invoke('queries:history-list', profileId),
    historyAdd: (profileId: string, sql: string): Promise<void> =>
      ipcRenderer.invoke('queries:history-add', profileId, sql),
    savedList: (profileId: string): Promise<SavedQuery[]> =>
      ipcRenderer.invoke('queries:saved-list', profileId),
    save: (profileId: string, name: string, sql: string): Promise<SavedQuery> =>
      ipcRenderer.invoke('queries:save', profileId, name, sql),
    deleteSaved: (profileId: string, id: string): Promise<void> =>
      ipcRenderer.invoke('queries:saved-delete', profileId, id)
  },
  connection: {
    test: (profileId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('connection:test', profileId),
    open: (profileId: string, database?: string): Promise<string> =>
      ipcRenderer.invoke('connection:open', profileId, database),
    close: (connectionId: string): Promise<void> =>
      ipcRenderer.invoke('connection:close', connectionId)
  },
  platform: process.platform as 'darwin' | 'win32' | 'linux',
  windowControls: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    maximize: (): void => ipcRenderer.send('window:maximize'),
    close: (): void => ipcRenderer.send('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChanged: (cb: (max: boolean) => void): void => {
      ipcRenderer.on('window:maximize-changed', (_e, max: boolean) => cb(max))
    }
  },
  appearance: {
    // sendSync runs at preload load, before the renderer's scripts — so the
    // renderer entry can stamp the <html> theme class before React mounts.
    initialTheme: ipcRenderer.sendSync('appearance:get-initial') as 'light' | 'dark',
    getMode: (): Promise<'light' | 'dark' | 'system'> => ipcRenderer.invoke('appearance:get-mode'),
    setMode: (mode: 'light' | 'dark' | 'system'): Promise<void> =>
      ipcRenderer.invoke('appearance:set-mode', mode),
    onThemeChanged: (cb: (t: 'light' | 'dark') => void): void => {
      ipcRenderer.on('appearance:theme-changed', (_e, t: 'light' | 'dark') => cb(t))
    }
  },
  dialog: {
    openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:open-file'),
    openTextFile: (exts: string[]): Promise<{ name: string; text: string } | null> =>
      ipcRenderer.invoke('dialog:open-text', exts)
  },
  exportFile: {
    save: (defaultName: string, text: string, gzip: boolean): Promise<boolean> =>
      ipcRenderer.invoke('export:save', defaultName, text, gzip)
  },
  onDbHostRestarted: (cb: () => void): void => {
    ipcRenderer.on('db-host:restarted', () => cb())
  }
})

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('fordb', {
  getDbHostPort: (): Promise<MessagePort> =>
    new Promise((resolve) => {
      ipcRenderer.once('db-host:port', (event) => {
        const port = event.ports[0]
        if (port) resolve(port)
      })
      void ipcRenderer.invoke('db-host:request-port')
    })
})

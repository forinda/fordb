import { app, BrowserWindow, ipcMain, utilityProcess, MessageChannelMain } from 'electron'
import { join } from 'node:path'
import { createRpcClient } from '../shared/rpc/client'
import type { PortLike } from '../shared/rpc/protocol'
import type { HostApi } from '../shared/host/host-api'

let dbHost: Electron.UtilityProcess | null = null
export let hostControl: HostApi | null = null

function controlPortLike(port: Electron.MessagePortMain): PortLike {
  return {
    postMessage: (msg) => port.postMessage(msg),
    onMessage: (cb) => port.on('message', (e) => cb(e.data)),
    onClose: (cb) => port.on('close', cb)
  }
}

function startDbHost(): void {
  dbHost = utilityProcess.fork(join(__dirname, 'db-host.js'), [], { serviceName: 'fordb-db-host' })
  // Private control channel: main keeps one end as an RPC client to HostApi.
  const { port1, port2 } = new MessageChannelMain()
  dbHost.postMessage({ type: 'new-client' }, [port1])
  const client = createRpcClient<HostApi>(controlPortLike(port2))
  port2.start()
  hostControl = client
  dbHost.on('exit', () => {
    hostControl = null
    startDbHost() // respawn; live connections are lost — renderer must reconnect
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

ipcMain.handle('db-host:request-port', (event) => {
  const { port1, port2 } = new MessageChannelMain()
  dbHost?.postMessage({ type: 'new-client' }, [port1])
  event.sender.postMessage('db-host:port', null, [port2])
})

void app.whenReady().then(() => {
  startDbHost()
  createWindow()
})
app.on('window-all-closed', () => app.quit())

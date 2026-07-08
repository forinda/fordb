import { app, BrowserWindow, ipcMain, utilityProcess, MessageChannelMain } from 'electron'
import { join } from 'node:path'
import { createRpcClient } from '../shared/rpc/client'
import type { PortLike } from '../shared/rpc/protocol'
import type { HostApi } from '../shared/host/host-api'
import { registerIpc } from './ipc'

let dbHost: Electron.UtilityProcess | null = null
export let hostControl: HostApi | null = null

// Supervision backoff: an immediate-crash loop (bad build, missing binding)
// must not become a tight fork bomb. Count restarts where the process died
// sooner than HEALTHY_MS after spawn; back off exponentially and give up after
// MAX_RAPID_RESTARTS so a broken db-host degrades to "unavailable" (surfaced by
// the IPC layer) instead of pinning the CPU.
const HEALTHY_MS = 5000
const MAX_RAPID_RESTARTS = 5
let rapidRestarts = 0
let quitting = false

function controlPortLike(port: Electron.MessagePortMain): PortLike {
  return {
    postMessage: (msg) => port.postMessage(msg),
    onMessage: (cb) => port.on('message', (e) => cb(e.data)),
    onClose: (cb) => port.on('close', cb)
  }
}

function startDbHost(): void {
  const spawnedAt = Date.now()
  dbHost = utilityProcess.fork(join(__dirname, 'db-host.js'), [], { serviceName: 'fordb-db-host' })
  // Private control channel: main keeps one end as an RPC client to HostApi.
  const { port1, port2 } = new MessageChannelMain()
  dbHost.postMessage({ type: 'new-client' }, [port1])
  const client = createRpcClient<HostApi>(controlPortLike(port2))
  port2.start()
  hostControl = client
  dbHost.on('exit', () => {
    hostControl = null
    dbHost = null
    if (quitting) return
    // live connections are lost on respawn — renderer must reconnect
    if (Date.now() - spawnedAt < HEALTHY_MS) rapidRestarts += 1
    else rapidRestarts = 0
    if (rapidRestarts > MAX_RAPID_RESTARTS) {
      console.error(`db-host crashed ${rapidRestarts} times rapidly; giving up until app restart`)
      return
    }
    const backoffMs = Math.min(1000 * 2 ** (rapidRestarts - 1), 30000)
    setTimeout(
      () => {
        if (!quitting) startDbHost()
      },
      rapidRestarts > 0 ? backoffMs : 0
    )
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
  registerIpc(() => hostControl)
  createWindow()
})
app.on('before-quit', () => {
  quitting = true
})
app.on('window-all-closed', () => app.quit())

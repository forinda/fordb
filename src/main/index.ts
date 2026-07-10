import {
  app,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  utilityProcess,
  MessageChannelMain
} from 'electron'
import { join } from 'node:path'
import { createRpcClient } from '@shared/rpc/client'
import type { PortLike } from '@shared/rpc/protocol'
import type { HostApi } from '@shared/host/host-api'
import { registerIpc } from './ipc'
import { SettingsStore } from './settings-store'
import { resolveTheme, type ThemeMode } from '@shared/theme'

let dbHost: Electron.UtilityProcess | null = null
export let hostControl: HostApi | null = null

// Constructed in whenReady (app.getPath is only reliable once the app is ready).
let settings: SettingsStore | null = null
let currentMode: ThemeMode = 'system'

function effectiveTheme(): 'light' | 'dark' {
  return resolveTheme(currentMode, nativeTheme.shouldUseDarkColors)
}

function broadcastTheme(): void {
  const t = effectiveTheme()
  for (const win of BrowserWindow.getAllWindows())
    win.webContents.send('appearance:theme-changed', t)
}

function broadcastDbHostRestarted(): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('db-host:restarted')
}

// Sync read so preload can stamp the theme before the renderer's React mounts.
ipcMain.on('appearance:get-initial', (e) => {
  e.returnValue = effectiveTheme()
})
ipcMain.handle('appearance:get-mode', () => currentMode)
ipcMain.handle('appearance:set-mode', async (_e, mode: ThemeMode) => {
  currentMode = mode
  await settings?.setTheme(mode)
  broadcastTheme()
})
nativeTheme.on('updated', () => broadcastTheme())

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
  const client = createRpcClient<HostApi>(controlPortLike(port2), { timeoutMs: 120_000 })
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
        if (!quitting) {
          startDbHost()
          // The old connections are gone; tell the renderer so it surfaces
          // "connection lost" instead of hanging on a dead port.
          broadcastDbHostRestarted()
        }
      },
      rapidRestarts > 0 ? backoffMs : 0
    )
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    frame: false,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.on('maximize', () => win.webContents.send('window:maximize-changed', true))
  win.on('unmaximize', () => win.webContents.send('window:maximize-changed', false))
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

// Frameless window controls, addressed to the sender's window (multi-window safe).
ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
ipcMain.on('window:maximize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w) return
  if (w.isMaximized()) w.unmaximize()
  else w.maximize()
})
ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
ipcMain.handle('window:is-maximized', (e) =>
  Boolean(BrowserWindow.fromWebContents(e.sender)?.isMaximized())
)

ipcMain.handle('db-host:request-port', (event) => {
  const { port1, port2 } = new MessageChannelMain()
  dbHost?.postMessage({ type: 'new-client' }, [port1])
  event.sender.postMessage('db-host:port', null, [port2])
})

void app.whenReady().then(async () => {
  settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
  currentMode = await settings.getTheme()
  startDbHost()
  registerIpc(() => hostControl)
  createWindow()
})
app.on('before-quit', () => {
  quitting = true
})
app.on('window-all-closed', () => app.quit())

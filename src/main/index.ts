import { app, BrowserWindow, ipcMain, utilityProcess, MessageChannelMain } from 'electron'
import { join } from 'node:path'

let dbHost: Electron.UtilityProcess | null = null

function startDbHost(): void {
  dbHost = utilityProcess.fork(join(__dirname, 'db-host.js'), [], { serviceName: 'fordb-db-host' })
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
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
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

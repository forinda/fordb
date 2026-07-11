import { app } from 'electron'
// electron-updater is CommonJS; a named ESM import (`import { autoUpdater }`)
// throws "Named export not found" in the packaged ESM main. Import the default
// (= module.exports) and destructure — the runtime-safe form.
import electronUpdater from 'electron-updater'
import { canAutoUpdate } from '../shared/updater'
import type { UpdaterStatus } from '../shared/updater'

// Accessed lazily (not destructured at module load): reading `.autoUpdater`
// constructs the singleton, which calls app.getVersion().
const au = (): typeof electronUpdater.autoUpdater => electronUpdater.autoUpdater

let emitStatus: (s: UpdaterStatus) => void = () => {}
let wired = false

export function initUpdater(emit: (s: UpdaterStatus) => void): void {
  emitStatus = emit
  if (wired) return
  wired = true
  try {
    au().autoDownload = true
    au().autoInstallOnAppQuit = false
    au().on('checking-for-update', () => emitStatus({ status: 'checking' }))
    au().on('update-available', (info) =>
      emitStatus({ status: 'available', version: info.version })
    )
    au().on('update-not-available', () => emitStatus({ status: 'not-available' }))
    au().on('download-progress', (p) =>
      emitStatus({ status: 'downloading', percent: Math.round(p.percent) })
    )
    au().on('update-downloaded', (info) =>
      emitStatus({ status: 'downloaded', version: info.version })
    )
    au().on('error', (e) =>
      emitStatus({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    )
  } catch (e) {
    emitStatus({ status: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

export function checkForUpdates(): void {
  const isAppImage = !!process.env.APPIMAGE
  if (!canAutoUpdate(app.isPackaged, process.platform, isAppImage)) {
    emitStatus({ status: 'unsupported' })
    return
  }
  try {
    emitStatus({ status: 'checking' })
    void au().checkForUpdates()
  } catch (e) {
    emitStatus({ status: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

export function quitAndInstall(): void {
  try {
    au().quitAndInstall()
  } catch (e) {
    emitStatus({ status: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

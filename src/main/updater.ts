import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdaterStatus } from '../shared/updater'

/** electron-updater updates NSIS (Windows) and AppImage (Linux) only.
 *  deb/rpm (no APPIMAGE env) and dev builds are excluded. */
export function canAutoUpdate(
  isPackaged: boolean,
  platform: NodeJS.Platform,
  isAppImage: boolean
): boolean {
  return isPackaged && (platform === 'win32' || isAppImage)
}

let emitStatus: (s: UpdaterStatus) => void = () => {}
let wired = false

export function initUpdater(emit: (s: UpdaterStatus) => void): void {
  emitStatus = emit
  if (wired) return
  wired = true
  try {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('checking-for-update', () => emitStatus({ status: 'checking' }))
    autoUpdater.on('update-available', (info) =>
      emitStatus({ status: 'available', version: info.version })
    )
    autoUpdater.on('update-not-available', () => emitStatus({ status: 'not-available' }))
    autoUpdater.on('download-progress', (p) =>
      emitStatus({ status: 'downloading', percent: Math.round(p.percent) })
    )
    autoUpdater.on('update-downloaded', (info) =>
      emitStatus({ status: 'downloaded', version: info.version })
    )
    autoUpdater.on('error', (e) =>
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
    void autoUpdater.checkForUpdates()
  } catch (e) {
    emitStatus({ status: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

export function quitAndInstall(): void {
  try {
    autoUpdater.quitAndInstall()
  } catch (e) {
    emitStatus({ status: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

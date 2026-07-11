export type UpdaterStatus =
  | { status: 'idle' }
  | { status: 'unsupported' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'not-available' }
  | { status: 'downloading'; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

/** electron-updater updates NSIS (Windows) and AppImage (Linux) only.
 *  deb/rpm (no APPIMAGE env) and dev builds are excluded. Pure — kept here (not
 *  in the main updater module) so unit tests don't import electron-updater. */
export function canAutoUpdate(
  isPackaged: boolean,
  platform: NodeJS.Platform,
  isAppImage: boolean
): boolean {
  return isPackaged && (platform === 'win32' || isAppImage)
}

/** Pure type guard: the restart banner shows only once an update is downloaded. */
export function bannerVisible(
  s: UpdaterStatus
): s is Extract<UpdaterStatus, { status: 'downloaded' }> {
  return s.status === 'downloaded'
}

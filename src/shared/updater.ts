export type UpdaterStatus =
  | { status: 'idle' }
  | { status: 'unsupported' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'not-available' }
  | { status: 'downloading'; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

/** Pure type guard: the restart banner shows only once an update is downloaded. */
export function bannerVisible(
  s: UpdaterStatus
): s is Extract<UpdaterStatus, { status: 'downloaded' }> {
  return s.status === 'downloaded'
}

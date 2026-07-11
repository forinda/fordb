import { describe, it, expect } from 'vitest'
import { canAutoUpdate, bannerVisible, type UpdaterStatus } from '../../src/shared/updater'

describe('canAutoUpdate', () => {
  it('packaged AppImage on linux → true', () => {
    expect(canAutoUpdate(true, 'linux', true)).toBe(true)
  })
  it('packaged NSIS on windows → true (regardless of AppImage)', () => {
    expect(canAutoUpdate(true, 'win32', false)).toBe(true)
  })
  it('packaged linux non-AppImage (deb/rpm) → false', () => {
    expect(canAutoUpdate(true, 'linux', false)).toBe(false)
  })
  it('not packaged (dev) → false even on win32', () => {
    expect(canAutoUpdate(false, 'win32', true)).toBe(false)
  })
})

describe('bannerVisible', () => {
  it('true only for downloaded', () => {
    expect(bannerVisible({ status: 'downloaded', version: '0.4.0' })).toBe(true)
  })
  it('false for other statuses', () => {
    const others: UpdaterStatus[] = [
      { status: 'idle' },
      { status: 'checking' },
      { status: 'not-available' },
      { status: 'downloading', percent: 10 },
      { status: 'unsupported' },
      { status: 'available', version: '0.4.0' },
      { status: 'error', message: 'x' }
    ]
    for (const s of others) expect(bannerVisible(s)).toBe(false)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore } from '../../src/main/settings-store'

let store: SettingsStore
beforeEach(() => {
  store = new SettingsStore(join(mkdtempSync(join(tmpdir(), 'fordb-set-')), 'settings.json'))
})

describe('SettingsStore', () => {
  it('defaults theme to system when file absent', async () => {
    expect(await store.getTheme()).toBe('system')
  })
  it('round-trips a theme mode', async () => {
    await store.setTheme('dark')
    expect(await store.getTheme()).toBe('dark')
  })
  it('falls back to system after re-setting to system', async () => {
    await store.setTheme('light')
    await store.setTheme('system')
    expect(await store.getTheme()).toBe('system')
  })
})

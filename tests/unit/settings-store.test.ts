import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
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

describe('SettingsStore editor theme', () => {
  it('defaults to the app theme when absent', async () => {
    expect(await store.getEditorTheme()).toBe('app')
  })

  it('round-trips a chosen theme', async () => {
    await store.setEditorTheme('monokai')
    expect(await store.getEditorTheme()).toBe('monokai')
  })

  it('falls back to the default for an unknown id', async () => {
    // Hand-edited settings.json, or a theme removed in a later version — must
    // not leave the editor unstyled.
    const file = join(mkdtempSync(join(tmpdir(), 'fordb-set-')), 'settings.json')
    writeFileSync(file, JSON.stringify({ editorTheme: 'no-such-theme' }), 'utf8')
    expect(await new SettingsStore(file).getEditorTheme()).toBe('app')
  })

  it('keeps the app theme mode and the editor theme independent', async () => {
    await store.setTheme('light')
    await store.setEditorTheme('monokai')
    expect(await store.getTheme()).toBe('light')
    expect(await store.getEditorTheme()).toBe('monokai')
  })
})

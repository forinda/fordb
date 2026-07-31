import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Headless SQLite. Covers the whole editor-theme chain: Preferences picker →
// IPC → settings.json → the CodeMirror compartment, and that the choice
// survives a restart.
test('pick an editor theme; it applies and persists', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-thm-')), 'd.sqlite')
  const db = createClient({ url: `file:${file}` })
  await db.executeMultiple(`CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT);`)
  db.close()
  const userData = mkdtempSync(join(tmpdir(), 'fordb-ud-'))
  const launch = {
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  }

  let app = await electron.launch(launch)
  let win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByRole('radio', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('themed')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Test & Save').click()
  await win.getByText('themed', { exact: true }).click()
  await win.getByText('Connect', { exact: true }).click()
  await win.locator('.cm-content').waitFor({ timeout: 15000 })

  const editorBg = async (): Promise<string> =>
    win.evaluate(() => getComputedStyle(document.querySelector('.cm-editor')!).backgroundColor)

  const appThemeBg = await editorBg()

  await win.getByLabel('open-settings').click()
  await win.getByLabel('editor-theme').click()
  await win.getByRole('option', { name: 'Monokai' }).click()
  await win.keyboard.press('Escape')

  // Monokai's signature background, and proof the packaged theme replaced the
  // app-token surfaces rather than layering over them.
  await expect.poll(editorBg, { timeout: 10000 }).toBe('rgb(39, 40, 34)')
  expect(appThemeBg).not.toBe('rgb(39, 40, 34)')

  await app.close()

  // Restart: the choice comes back from settings.json.
  app = await electron.launch(launch)
  win = await app.firstWindow()
  await win.getByText('themed', { exact: true }).click()
  await win.getByText('Connect', { exact: true }).click()
  await win.locator('.cm-content').waitFor({ timeout: 15000 })
  await expect.poll(editorBg, { timeout: 10000 }).toBe('rgb(39, 40, 34)')

  await app.close()
})

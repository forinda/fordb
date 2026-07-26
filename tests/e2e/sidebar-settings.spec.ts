import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The app Preferences used to hide behind a plain "Settings" text link in the
// status bar. A "Settings" row is now pinned at the bottom of the editor
// sidebar; clicking it opens the same Preferences modal. SQLite keeps this
// headless.
test('open Preferences from the pinned sidebar Settings row', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-settings-')), 's.sqlite')
  const userData = mkdtempSync(join(tmpdir(), 'fordb-ud-'))
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByRole('radio', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('settings-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Test & Save').click()
  await win.getByText('settings-sqlite').click()
  await win.getByText('Connect', { exact: true }).click()

  // The sidebar Settings row opens the Preferences modal.
  await win.getByLabel('open-settings').click()
  await expect(win.getByRole('dialog')).toBeVisible({ timeout: 15000 })
  await expect(win.getByText('Appearance', { exact: true })).toBeVisible()

  await app.close()
})

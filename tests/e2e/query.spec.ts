import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('connect, run a query, see rows', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'fordb-query-'))
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByPlaceholder('Name', { exact: true }).fill('local-q')
  await win.getByPlaceholder('Host', { exact: true }).fill('127.0.0.1')
  await win.getByPlaceholder('Port', { exact: true }).fill('54329')
  await win.getByPlaceholder('Database', { exact: true }).fill('fordb_test')
  await win.getByPlaceholder('User', { exact: true }).fill('fordb')
  await win.getByPlaceholder('Password', { exact: true }).fill('fordb')
  await win.getByText('Test & Save').click()
  // Card click selects; Connect happens in the details panel (Dialect).
  await win.getByText('local-q').click()
  await win.getByText('Connect', { exact: true }).click()

  // Type a query into the CodeMirror editor and run it.
  await win.locator('.cm-content').click()
  await win.keyboard.type('SELECT id, email FROM app.users ORDER BY id')
  await win.getByText('Run', { exact: true }).click()
  await expect(win.getByText(/rows/)).toBeVisible({ timeout: 15000 })

  await app.close()
})

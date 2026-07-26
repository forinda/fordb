import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Server settings is a first-class full-pane view now (was a sub-tab under the
// monitoring dashboard, with no discoverable entry point). Open it from the
// sidebar "Server settings" row and assert the GUC table renders.
test('open server settings as a full-pane view from the sidebar', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'fordb-srvset-'))
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByPlaceholder('Name', { exact: true }).fill('srvset-pg')
  await win.getByPlaceholder('Host', { exact: true }).fill('127.0.0.1')
  await win.getByPlaceholder('Port', { exact: true }).fill('54329')
  await win.getByPlaceholder('Database', { exact: true }).fill('fordb_test')
  await win.getByPlaceholder('User', { exact: true }).fill('fordb')
  await win.getByPlaceholder('Password', { exact: true }).fill('fordb')
  await win.getByText('Test & Save').click()
  await win.getByText('srvset-pg').click()
  await win.getByText('Connect', { exact: true }).click()
  await expect(win.getByText('app', { exact: true })).toBeVisible({ timeout: 15000 })

  await win.getByRole('button', { name: 'Server settings', exact: true }).click()
  // The GUC settings table (own page, not nested under the monitoring charts).
  await expect(win.getByPlaceholder('Filter by name or category…')).toBeVisible({ timeout: 15000 })

  await app.close()
})

import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('connect, open dashboard, see gauges and sessions', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'fordb-dash-'))
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByPlaceholder('Name', { exact: true }).fill('local-dash')
  await win.getByPlaceholder('Host', { exact: true }).fill('127.0.0.1')
  await win.getByPlaceholder('Port', { exact: true }).fill('54329')
  await win.getByPlaceholder('Database', { exact: true }).fill('fordb_test')
  await win.getByPlaceholder('User', { exact: true }).fill('fordb')
  await win.getByPlaceholder('Password', { exact: true }).fill('fordb')
  await win.getByText('Test & Save').click()
  // Card click selects; Connect happens in the details panel (Dialect).
  await win.getByText('local-dash').click()
  await win.getByText('Connect', { exact: true }).click()

  // Switch to the dashboard and confirm live stats render.
  await win.getByText('Dashboard', { exact: true }).click()
  await expect(win.getByText('Backends')).toBeVisible({ timeout: 15000 }) // a gauge
  // The sessions tab is present (dashboard admin surface rendered).
  await expect(win.getByRole('button', { name: 'sessions' })).toBeVisible()

  await app.close()
})

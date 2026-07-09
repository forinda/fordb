import { test, expect, _electron as electron } from '@playwright/test'

test('connect, open dashboard, see gauges and sessions', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
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
  await win.getByText('Test', { exact: true }).click()
  await expect(win.getByText('OK')).toBeVisible({ timeout: 15000 })
  await win.getByText('Save').click()
  await win.getByText('local-dash').click()

  // Switch to the dashboard and confirm live stats render.
  await win.getByText('Dashboard', { exact: true }).click()
  await expect(win.getByText('Backends')).toBeVisible({ timeout: 15000 }) // a gauge
  await expect(win.getByText('Sessions')).toBeVisible()

  await app.close()
})

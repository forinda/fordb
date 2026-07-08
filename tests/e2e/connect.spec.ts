import { test, expect, _electron as electron } from '@playwright/test'

test('create profile, test, connect, see schema tree', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByPlaceholder('Name').fill('local-test')
  await win.getByPlaceholder('Host').fill('127.0.0.1')
  await win.getByPlaceholder('Port').fill('54329')
  await win.getByPlaceholder('Database').fill('fordb_test')
  await win.getByPlaceholder('User').fill('fordb')
  await win.getByPlaceholder('Password').fill('fordb')
  await win.getByText('Test', { exact: true }).click()
  await expect(win.getByText('OK')).toBeVisible({ timeout: 15000 })

  await win.getByText('Save').click()
  await win.getByText('local-test').click()
  await expect(win.getByText('app')).toBeVisible({ timeout: 15000 }) // schema node
  await app.close()
})

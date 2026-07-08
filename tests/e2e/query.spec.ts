import { test, expect, _electron as electron } from '@playwright/test'

test('connect, run a query, see rows', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByPlaceholder('Name').fill('local-q')
  await win.getByPlaceholder('Host').fill('127.0.0.1')
  await win.getByPlaceholder('Port').fill('54329')
  await win.getByPlaceholder('Database').fill('fordb_test')
  await win.getByPlaceholder('User').fill('fordb')
  await win.getByPlaceholder('Password').fill('fordb')
  await win.getByText('Test', { exact: true }).click()
  await expect(win.getByText('OK')).toBeVisible({ timeout: 15000 })
  await win.getByText('Save').click()
  await win.getByText('local-q').click()

  // Type a query into the CodeMirror editor and run it.
  await win.locator('.cm-content').click()
  await win.keyboard.type('SELECT id, email FROM app.users ORDER BY id')
  await win.getByText('Run', { exact: true }).click()
  await expect(win.getByText(/rows/)).toBeVisible({ timeout: 15000 })

  await app.close()
})

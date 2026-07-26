import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The sidebar connection switcher must switch to another saved profile IN PLACE
// (no trip to the Connections screen). Two SQLite DBs with distinct tables:
// connect to A, switch to B via the switcher, assert B's table appears. SQLite
// keeps this fully headless (no keychain).
test('switch connection in place from the sidebar switcher', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fordb-switch-'))
  const fileA = join(dir, 'a.sqlite')
  const fileB = join(dir, 'b.sqlite')
  const dbA = createClient({ url: `file:${fileA}` })
  await dbA.executeMultiple('CREATE TABLE alpha_widgets (id INTEGER PRIMARY KEY);')
  dbA.close()
  const dbB = createClient({ url: `file:${fileB}` })
  await dbB.executeMultiple('CREATE TABLE beta_widgets (id INTEGER PRIMARY KEY);')
  dbB.close()

  const userData = mkdtempSync(join(tmpdir(), 'fordb-ud-'))
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  // Create profile A.
  await win.getByText('+ New connection').click()
  await win.getByRole('radio', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('conn-a')
  await win.getByPlaceholder('File', { exact: true }).fill(fileA)
  await win.getByText('Test & Save').click()

  // Create profile B.
  await win.getByText('+ New connection').click()
  await win.getByRole('radio', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('conn-b')
  await win.getByPlaceholder('File', { exact: true }).fill(fileB)
  await win.getByText('Test & Save').click()

  // Connect to A.
  await win.getByText('conn-a').click()
  await win.getByText('Connect', { exact: true }).click()
  await win.getByText('main', { exact: true }).click()
  await win.getByText('Tables', { exact: true }).click()
  await expect(win.getByText('alpha_widgets')).toBeVisible({ timeout: 15000 })

  // Switch to B via the sidebar switcher — no Connections-screen round trip.
  await win.getByLabel('connection-switcher').click()
  await win.getByRole('button', { name: /conn-b/ }).click()

  // B's schema now renders in place.
  await win.getByText('main', { exact: true }).click()
  await win.getByText('Tables', { exact: true }).click()
  await expect(win.getByText('beta_widgets')).toBeVisible({ timeout: 15000 })
  await expect(win.getByText('alpha_widgets')).toHaveCount(0)

  await app.close()
})

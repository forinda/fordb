import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// SQLite has no secrets, so unlike the Postgres e2e this runs fully headless —
// no OS keychain needed.
test('create a sqlite connection, browse, run a query', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-e2e-')), 'e2e.sqlite')
  const db = createClient({ url: `file:${file}` })
  await db.executeMultiple(
    `CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT);
     INSERT INTO widgets (label) VALUES ('x'), ('y');`
  )
  db.close()

  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  // Engine selector is a Radix Select (not a native <select>): open + pick.
  await win.getByRole('combobox', { name: 'Database engine' }).click()
  await win.getByRole('option', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('e2e-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Save').click()
  await win.getByText('e2e-sqlite').click()

  // The schema tree shows the `main` namespace; expand it to reveal the table.
  await win.getByText('main', { exact: true }).click()
  await expect(win.getByText('widgets')).toBeVisible({ timeout: 15000 })

  await win.locator('.cm-content').click()
  await win.keyboard.type('SELECT id, label FROM widgets ORDER BY id')
  await win.getByText('Run', { exact: true }).click()
  await expect(win.getByText(/rows/)).toBeVisible({ timeout: 15000 })

  await app.close()
})

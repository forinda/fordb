import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Headless SQLite. Browse a view's definition, then create + drop a view from the
// Views category folder.
test('view definition + create/drop view', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-obj-')), 'o.sqlite')
  const db = createClient({ url: `file:${file}` })
  await db.executeMultiple(
    `CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT);
     CREATE VIEW v AS SELECT id FROM t;`
  )
  db.close()
  const userData = mkdtempSync(join(tmpdir(), 'fordb-ud-'))

  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()
  win.on('dialog', (d) => void d.accept()) // auto-confirm DDL previews

  await win.getByText('+ New connection').click()
  await win.getByRole('combobox', { name: 'Database engine' }).click()
  await win.getByRole('option', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('obj-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Save').click()
  // Card click selects; Connect happens in the details panel (Dialect).
  await win.getByText('obj-sqlite').click()
  await win.getByText('Connect', { exact: true }).click()

  await win.getByText('main', { exact: true }).click()
  // Expand the Views category folder and open the view's definition.
  await win.getByText('Views', { exact: true }).click()
  await win.getByText('v', { exact: true }).click()
  await expect(win.locator('pre')).toContainText(/CREATE VIEW|SELECT/i, { timeout: 15000 })

  // Create a new view from the Views folder menu.
  await win.getByText('Views', { exact: true }).click({ button: 'right' })
  await win.getByText('New view…', { exact: true }).click()
  await win.getByLabel('view-name-input').fill('v2')
  await win.getByLabel('view-select-input').fill('SELECT label FROM t')
  await win.getByText('Create', { exact: true }).click()
  await expect(win.getByText('v2', { exact: true })).toBeVisible({ timeout: 15000 })

  // Drop it.
  await win.getByText('v2', { exact: true }).click({ button: 'right' })
  await win.getByText('Drop view', { exact: true }).click()
  await expect(win.getByText('v2', { exact: true })).toHaveCount(0, { timeout: 15000 })

  await app.close()
})

import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Headless SQLite (no keychain). The DDL preview is a native confirm dialog, so
// a page 'dialog' handler auto-accepts it. Filter correctness / DDL generation
// is covered by the unit + contract tests; this asserts the structure UI wiring.
test('view structure and add a column (previewed)', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-struct-')), 's.sqlite')
  const db = createClient({ url: `file:${file}` })
  await db.executeMultiple(`CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT);`)
  db.close()
  const userData = mkdtempSync(join(tmpdir(), 'fordb-ud-'))

  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()
  win.on('dialog', (d) => void d.accept()) // auto-confirm the DDL preview

  await win.getByText('+ New connection').click()
  await win.getByRole('radio', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('struct-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Test & Save').click()
  // Card click selects; Connect happens in the details panel (Dialect).
  await win.getByText('struct-sqlite').click()
  await win.getByText('Connect', { exact: true }).click()

  await win.getByText('main', { exact: true }).click()
  await win.getByText('Tables', { exact: true }).click() // expand the Tables folder
  await win.getByText('widgets').click({ button: 'right' })
  await win.getByText('Structure', { exact: true }).click()

  // Columns panel shows the existing columns.
  await expect(win.getByText('label', { exact: true })).toBeVisible({ timeout: 15000 })

  // Add a column.
  await win.getByText('+ column', { exact: true }).click()
  await win.getByLabel('ddl-column-name').fill('qty')
  await win.getByLabel('ddl-column-type').fill('integer')
  await win.getByText('Add', { exact: true }).click()

  await expect(win.getByText('qty', { exact: true })).toBeVisible({ timeout: 15000 })
  await app.close()
})

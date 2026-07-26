import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Import is a full-pane destination (mode bar) now. Drive the page for both
// formats; the native open dialog is stubbed to return a SQL or CSV fixture
// based on the requested extensions.
test('import SQL and CSV from the Import page', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-imp-')), 'e.sqlite')
  const db = createClient({ url: `file:${file}` })
  await db.executeMultiple('CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT);')
  db.close()
  const userData = mkdtempSync(join(tmpdir(), 'fordb-ud-'))

  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('dialog:open-text')
    ipcMain.handle('dialog:open-text', (_e, exts: string[]) =>
      exts.includes('csv')
        ? { name: 'rows.csv', text: 'id,label\n2,alpha\n3,beta\n' }
        : { name: 'seed.sql', text: "INSERT INTO t (id, label) VALUES (1, 'sql');" }
    )
  })

  await win.getByText('+ New connection').click()
  await win.getByRole('radio', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('imp-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Test & Save').click()
  await win.getByText('imp-sqlite').click()
  await win.getByText('Connect', { exact: true }).click()

  // Open the Import page and run the SQL fixture.
  await win.getByRole('button', { name: 'Import', exact: true }).click()
  await win.getByText('Choose SQL file…', { exact: true }).click()
  await expect(win.getByText(/Ran 1 statement/)).toBeVisible({ timeout: 15000 })

  // CSV: pick format + table, choose file → mapping dialog → Import.
  await win.getByText('CSV', { exact: true }).click()
  await win.getByText('Choose CSV file…', { exact: true }).click()
  await expect(win.getByText(/Import CSV →/)).toBeVisible({ timeout: 15000 })
  // The mapping dialog shares the "Import" label with the mode-bar button —
  // scope to the modal overlay (.z-50).
  await win.locator('.z-50').getByRole('button', { name: 'Import', exact: true }).click()

  // Verify: 1 (SQL) + 2 (CSV) = 3 rows.
  await win.getByRole('button', { name: 'Query', exact: true }).click()
  await win.locator('.cm-content').click()
  await win.keyboard.type('SELECT id FROM t ORDER BY id')
  await win.getByText('Run', { exact: true }).click()
  await expect(win.getByText(/3 rows/)).toBeVisible({ timeout: 15000 })

  await app.close()
})

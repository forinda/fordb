import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Native save/open dialogs can't be driven headlessly, so the export:save and
// dialog:open-text ipc handlers are replaced in the main process: export:save
// captures the dump text; dialog:open-text returns a fixture CSV.
test('export a table to SQL and import a CSV', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-ei-')), 'e.sqlite')
  const db = createClient({ url: `file:${file}` })
  await db.executeMultiple(
    `CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT);
     INSERT INTO t (id, label) VALUES (9, 'seed');`
  )
  db.close()
  const userData = mkdtempSync(join(tmpdir(), 'fordb-ud-'))

  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })

  const win = await app.firstWindow()

  // Replace the native-dialog IPC handlers in main (after registerIpc has run, so
  // removeHandler actually removes the real ones before we re-register).
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('export:save')
    ipcMain.handle('export:save', (_e, _name: string, text: string) => {
      ;(globalThis as Record<string, unknown>).__savedExport = text
      return true
    })
    ipcMain.removeHandler('dialog:open-text')
    ipcMain.handle('dialog:open-text', () => ({
      name: 'rows.csv',
      text: 'id,label\n1,alpha\n2,beta\n'
    }))
  })

  await win.getByText('+ New connection').click()
  await win.getByRole('radio', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('ei-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Test & Save').click()
  // Card click selects; Connect happens in the details panel (Dialect).
  await win.getByText('ei-sqlite').click()
  await win.getByText('Connect', { exact: true }).click()

  await win.getByText('main', { exact: true }).click()

  // Export the table to SQL → assert the captured dump has structure + data.
  await win.getByText('t', { exact: true }).click({ button: 'right' })
  await win.getByText('Export (SQL)', { exact: true }).click()
  await expect
    .poll(async () =>
      app.evaluate(() => (globalThis as Record<string, unknown>).__savedExport as string)
    )
    .toContain('CREATE TABLE')
  const dump = await app.evaluate(
    () => (globalThis as Record<string, unknown>).__savedExport as string
  )
  expect(dump).toContain('INSERT INTO')
  expect(dump).toContain("'seed'")

  // Import the fixture CSV (id,label auto-map) into the same table.
  await win.getByText('t', { exact: true }).click({ button: 'right' })
  await win.getByText('Import CSV…', { exact: true }).click()
  await win.getByText('Import', { exact: true }).click()

  // Verify: the table now has 3 rows (1 seed + 2 imported).
  await win.locator('.cm-content').click()
  await win.keyboard.type('SELECT id FROM t ORDER BY id')
  await win.getByText('Run', { exact: true }).click()
  await expect(win.getByText(/3 rows/)).toBeVisible({ timeout: 15000 })

  await app.close()
})

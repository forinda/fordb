import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Export is a full-pane destination (mode bar) now. Drive the page for both
// formats; the native save dialog is stubbed to capture the written text.
test('export a schema to SQL and a table to CSV from the Export page', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-exp-')), 'e.sqlite')
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

  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('export:save')
    ipcMain.handle('export:save', (_e, _name: string, text: string) => {
      ;(globalThis as Record<string, unknown>).__savedExport = text
      return true
    })
  })

  await win.getByText('+ New connection').click()
  await win.getByRole('radio', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('exp-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Test & Save').click()
  await win.getByText('exp-sqlite').click()
  await win.getByText('Connect', { exact: true }).click()

  // Open the Export page from the mode bar.
  await win.getByRole('button', { name: 'Export', exact: true }).click()

  // SQL (default): all tables checked → dump has structure + data.
  await win.getByRole('button', { name: 'Export', exact: true }).nth(1).click()
  await expect
    .poll(async () =>
      app.evaluate(() => (globalThis as Record<string, unknown>).__savedExport as string)
    )
    .toContain('CREATE TABLE')
  const dump = await app.evaluate(
    () => (globalThis as Record<string, unknown>).__savedExport as string
  )
  expect(dump).toContain("'seed'")

  // CSV: pick the format, export the single table → header + row.
  await win.getByText('CSV', { exact: true }).click()
  await win.getByRole('button', { name: 'Export', exact: true }).nth(1).click()
  await expect
    .poll(async () =>
      app.evaluate(() => (globalThis as Record<string, unknown>).__savedExport as string)
    )
    .toContain('id,label')

  await app.close()
})

import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Headless SQLite. Exercises the MA4 tools through the UI: Format, Save + reopen a
// named query, and Explain (plan view).
test('format, save + reopen, explain a query', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-qt-')), 'q.sqlite')
  const db = createClient({ url: `file:${file}` })
  await db.executeMultiple(`CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT);`)
  db.close()
  const userData = mkdtempSync(join(tmpdir(), 'fordb-ud-'))

  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByRole('radio', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('qt-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Test & Save').click()
  // Card click selects; Connect happens in the details panel (Dialect).
  await win.getByText('qt-sqlite').click()
  await win.getByText('Connect', { exact: true }).click()

  // Type lowercase SQL into the editor, then Format → uppercased keywords.
  const editor = win.locator('.cm-content')
  await editor.click()
  await win.keyboard.type('select id from widgets')
  await win.getByRole('button', { name: 'Format', exact: true }).click()
  await expect(win.locator('.cm-content')).toContainText('SELECT', { timeout: 15000 })

  // Save the query under a name.
  await win.getByRole('button', { name: 'Save', exact: true }).click()
  await win.getByLabel('save-query-name').fill('my-widgets')
  await win.locator('.fixed').getByRole('button', { name: 'Save', exact: true }).click()

  // Clear the editor, then reopen the saved query and assert it is restored.
  await editor.click()
  await win.keyboard.press('Control+A')
  await win.keyboard.press('Delete')
  await win.getByRole('button', { name: 'Saved', exact: true }).click()
  await win.getByText('my-widgets').click()
  await expect(win.locator('.cm-content')).toContainText('widgets', { timeout: 15000 })

  // Explain → a plan view renders (SQLite EXPLAIN QUERY PLAN → a SCAN row).
  await win.getByRole('button', { name: 'Explain', exact: true }).click()
  await expect(win.locator('pre')).toContainText(/SCAN|widgets/i, { timeout: 15000 })

  await app.close()
})

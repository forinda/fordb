import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Glide renders cells to a canvas (not DOM), so this asserts the DOM-observable
// filter controls render and Apply commits without error — filter *correctness*
// is covered by the adapter/host-api contract tests. Fully headless (SQLite).
test('filter a table in the data grid', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-browse-')), 'b.sqlite')
  const db = createClient({ url: `file:${file}` })
  await db.executeMultiple(
    `CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT);
     INSERT INTO widgets (label) VALUES ('apple'), ('banana'), ('avocado');`
  )
  db.close()

  const userData = mkdtempSync(join(tmpdir(), 'fordb-ud-'))
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByRole('combobox', { name: 'Database engine' }).click()
  await win.getByRole('option', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('browse-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Save').click()
  await win.getByText('browse-sqlite').click()

  await win.getByText('main', { exact: true }).click()
  await win.getByText('widgets').click() // single-click opens the data tab

  // Filter bar is rendered for the data tab.
  const column = win.getByLabel('filter-column').first()
  await expect(column).toBeVisible({ timeout: 15000 })
  await column.selectOption('label')
  await win.getByLabel('filter-op').first().selectOption('contains')
  await win.getByLabel('filter-value').first().fill('ban')
  await win.getByText('Apply', { exact: true }).click()

  // The tab is still live after applying (the grid re-ran via openBrowse).
  await expect(win.getByLabel('filter-column').first()).toBeVisible()

  await app.close()
})

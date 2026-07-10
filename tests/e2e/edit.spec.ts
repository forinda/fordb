import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Glide Data Grid renders cells to a <canvas>, so Playwright can't click grid
// cells / row markers directly (the query e2e likewise asserts DOM status text,
// never grid contents). So this e2e proves the DOM-observable edit WIRING —
// open a table's data tab from the tree, the editable toolbar renders, and the
// pending count reacts. The mutation correctness itself (update/insert/delete +
// rollback, bound values) is covered end-to-end by the adapter + HostApi
// contract tests on both engines.
test('open a table data tab with the editable toolbar', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-edit-')), 'edit.sqlite')
  const db = createClient({ url: `file:${file}` })
  await db.executeMultiple(
    `CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO widgets (label) VALUES ('a'), ('b');`
  )
  db.close()

  // Fresh userData dir per run so saved profiles don't accumulate across runs
  // (headless SQLite connects persist to profiles.json).
  const userData = mkdtempSync(join(tmpdir(), 'fordb-ud-'))

  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByRole('combobox', { name: 'Database engine' }).click()
  await win.getByRole('option', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('edit-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Save').click()
  // Card click selects; Connect happens in the details panel (Dialect).
  await win.getByText('edit-sqlite').click()
  await win.getByText('Connect', { exact: true }).click()

  await win.getByText('main', { exact: true }).click()
  await win.getByText('widgets').dblclick() // open the data tab

  // Editable toolbar renders (widgets has a PK + SQLite supports mutation).
  await expect(win.getByText('Review & apply')).toBeVisible({ timeout: 15000 })
  await expect(win.getByText('+ Row')).toBeVisible()
  await expect(win.getByText('0 pending')).toBeVisible()

  await app.close()
})

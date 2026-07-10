import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Headless SQLite. Exercises the two MA3b paths through the UI: a native RENAME
// COLUMN and a type change that forces the table-rebuild. The confirm/prompt
// dialogs are native, so a page handler auto-accepts them (prompt returns the new
// name). Data-preservation of the rebuild is proven by the contract suite; here we
// assert the reconstructed-DDL reflects both changes (i.e. the rebuild ran).
test('rename a column and change a column type (rebuild)', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-alter-')), 'a.sqlite')
  const db = createClient({ url: `file:${file}` })
  // label is UNIQUE so the type-change rebuild must preserve the constraint's
  // reserved sqlite_autoindex_* (regression guard for the rebuild re-emitting it).
  await db.executeMultiple(
    `CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT UNIQUE, amt REAL);
     INSERT INTO widgets (label, amt) VALUES ('a', 1.5);`
  )
  db.close()
  const userData = mkdtempSync(join(tmpdir(), 'fordb-ud-'))

  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()
  // The DDL preview is a native confirm; auto-accept it. (Rename uses an inline
  // input, not window.prompt — Electron doesn't support prompt.)
  win.on('dialog', (d) => void d.accept())

  await win.getByText('+ New connection').click()
  await win.getByRole('radio', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('alter-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Test & Save').click()
  // Card click selects; Connect happens in the details panel (Dialect).
  await win.getByText('alter-sqlite').click()
  await win.getByText('Connect', { exact: true }).click()

  await win.getByText('main', { exact: true }).click()
  await win.getByText('widgets').click({ button: 'right' })
  await win.getByText('Structure', { exact: true }).click()

  await expect(win.getByText('label', { exact: true })).toBeVisible({ timeout: 15000 })

  // Rename label → title (native ALTER RENAME COLUMN) via the inline input.
  await win.getByLabel('col-rename-label').click()
  await win.getByLabel('ddl-rename-to').fill('title')
  await win.getByText('Rename', { exact: true }).click()
  await expect(win.getByText('title', { exact: true })).toBeVisible({ timeout: 15000 })

  // Change amt's type REAL → NUMERIC (forces the table-rebuild).
  await win.getByLabel('col-alter-amt').click()
  await win.getByLabel('ddl-alter-type').fill('NUMERIC')
  await win.getByText('Apply', { exact: true }).click()

  // Reconstructed DDL reflects both changes → the rebuild ran successfully.
  const ddl = win.locator('pre')
  await expect(ddl).toContainText('"title"', { timeout: 15000 })
  await expect(ddl).toContainText('NUMERIC')

  await app.close()
})

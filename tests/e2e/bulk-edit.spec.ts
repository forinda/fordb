import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Bulk edit via the "Edit selected" form: select rows → set one column's value
// for all of them (inline cell editing can't do this — activating a cell clears
// the row selection).
test('edit selected sets a column across all selected rows', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-bulk-')), 'b.sqlite')
  const seed = createClient({ url: `file:${file}` })
  await seed.executeMultiple(
    `CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO widgets (label) VALUES ('a'), ('b');`
  )
  seed.close()

  const userData = mkdtempSync(join(tmpdir(), 'fordb-ud-'))
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByRole('radio', { name: 'SQLite' }).click()
  await win.getByPlaceholder('Name', { exact: true }).fill('bulk-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Test & Save').click()
  await win.getByText('bulk-sqlite').click()
  await win.getByText('Connect', { exact: true }).click()
  await win.getByText('main', { exact: true }).click()
  await win.getByText('Tables', { exact: true }).click() // expand the Tables folder
  await win.getByText('widgets').dblclick()
  await expect(win.getByText('+ Row')).toBeVisible({ timeout: 15000 })

  const surface = win.locator('.dvn-scroller').first()
  await surface.click({ position: { x: 12, y: 53 } })
  await surface.click({ position: { x: 12, y: 87 }, modifiers: ['Shift'] })
  await win.getByText('Edit selected').click()

  const modal = win.getByRole('dialog')
  await expect(modal).toBeVisible()
  await modal.locator('select').selectOption('label') // default is the non-pk column, but be explicit
  await modal.getByRole('textbox').fill('BULK')
  await modal.getByText('Set value', { exact: true }).click()

  // Two UPDATEs queued.
  await expect(win.getByText('2 pending')).toBeVisible({ timeout: 5000 })
  await win.getByText('Review & apply').click()
  await win.getByRole('dialog').getByText('Apply', { exact: true }).click()
  await expect(win.getByText('2 pending')).toHaveCount(0, { timeout: 10000 })
  await app.close()

  const verify = createClient({ url: `file:${file}` })
  const rs = await verify.execute('SELECT label FROM widgets')
  verify.close()
  expect(rs.rows.map((r) => String(r.label))).toEqual(['BULK', 'BULK'])
})

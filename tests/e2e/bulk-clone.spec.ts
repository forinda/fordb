import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Drives clone end-to-end: select rows via the grid row markers, click Clone,
// apply, and assert the duplicated rows persisted (pk dropped → new ids).
test('clone selected rows persists duplicates', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-clone-')), 'c.sqlite')
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
  await win.getByPlaceholder('Name', { exact: true }).fill('clone-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Test & Save').click()
  await win.getByText('clone-sqlite').click()
  await win.getByText('Connect', { exact: true }).click()
  await win.getByText('main', { exact: true }).click()
  await win.getByText('Tables', { exact: true }).click() // expand the Tables folder
  await win.getByText('widgets').dblclick()
  await expect(win.getByText('+ Row')).toBeVisible({ timeout: 15000 })

  // Select both rows via the row-marker checkboxes (leftmost column, ~x=12),
  // rows at y≈53 and y≈87.
  const surface = win.locator('.dvn-scroller').first()
  await surface.click({ position: { x: 12, y: 53 } })
  await surface.click({ position: { x: 12, y: 87 }, modifiers: ['Shift'] }) // range-select both
  await win.getByText('Clone', { exact: true }).click()

  // Two clones queued as inserts.
  await expect(win.getByText('2 pending')).toBeVisible({ timeout: 5000 })
  await win.getByText('Review & apply').click()
  const modal = win.getByRole('dialog')
  await expect(modal.locator('pre')).toContainText('INSERT')
  await modal.getByText('Apply', { exact: true }).click()
  await expect(win.getByText('2 pending')).toHaveCount(0, { timeout: 10000 })
  await app.close()

  // Four rows now: originals a,b + two clones.
  const verify = createClient({ url: `file:${file}` })
  const rs = await verify.execute('SELECT label FROM widgets')
  verify.close()
  const labels = rs.rows.map((r) => String(r.label)).sort()
  expect(labels).toEqual(['a', 'a', 'b', 'b'])
})

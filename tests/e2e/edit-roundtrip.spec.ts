import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Regression for the missing `<div id="portal">` — glide renders its cell edit
// overlay into that portal; without it, editing silently no-ops. Glide cells are
// canvas, but activating a cell (click, then second-click on the same cell) opens
// a real DOM overlay input we can type into, so we can drive a full edit here.
test('editing a cell persists to the database', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-editrt-')), 'edit.sqlite')
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
  await win.getByPlaceholder('Name', { exact: true }).fill('edit-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Test & Save').click()
  await win.getByText('edit-sqlite').click()
  await win.getByText('Connect', { exact: true }).click()
  await win.getByText('main', { exact: true }).click()
  await win.getByText('Tables', { exact: true }).click() // expand the Tables folder
  await win.getByText('widgets').dblclick()
  await expect(win.getByText('+ Row')).toBeVisible({ timeout: 15000 })

  // Select the "label" cell of row 0, then second-click to activate → the overlay
  // input opens in #portal. The label column centre is ~x=204, row 0 at y=53.
  const surface = win.locator('.dvn-scroller').first()
  await surface.click({ position: { x: 204, y: 53 } })
  await win.waitForTimeout(300)
  await surface.click({ position: { x: 204, y: 53 } })
  const overlayInput = win.locator('#portal input, #portal textarea').first()
  await overlayInput.waitFor({ timeout: 5000 })
  await overlayInput.fill('EDITED')
  await win.keyboard.press('Enter')

  await expect(win.getByText('1 pending')).toBeVisible({ timeout: 5000 })
  // Review & apply opens the themed modal (not a native confirm); its SQL
  // preview shows the UPDATE, and Apply commits.
  await win.getByText('Review & apply').click()
  const modal = win.getByRole('dialog')
  await expect(modal).toBeVisible()
  await expect(modal.locator('pre')).toContainText('UPDATE')
  await modal.getByText('Apply', { exact: true }).click()
  // Applied → the pending tray disappears.
  await expect(win.getByText('1 pending')).toHaveCount(0, { timeout: 10000 })
  await app.close()

  const verify = createClient({ url: `file:${file}` })
  const rs = await verify.execute('SELECT label FROM widgets ORDER BY id')
  verify.close()
  expect(rs.rows.map((r) => String(r.label))).toContain('EDITED')
})

import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The tree filter should surface a table WITHOUT first expanding its schema —
// typing a filter eagerly loads every schema's tables. Runs against the Docker
// Postgres (schema "app" with an "orders" table), and deliberately never clicks
// the "app" schema node before filtering.
test('filter finds a table in an unexpanded schema', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'fordb-treefilter-'))
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByPlaceholder('Name', { exact: true }).fill('tf-pg')
  await win.getByPlaceholder('Host', { exact: true }).fill('127.0.0.1')
  await win.getByPlaceholder('Port', { exact: true }).fill('54329')
  await win.getByPlaceholder('Database', { exact: true }).fill('fordb_test')
  await win.getByPlaceholder('User', { exact: true }).fill('fordb')
  await win.getByPlaceholder('Password', { exact: true }).fill('fordb')
  await win.getByText('Test & Save').click()
  await win.getByText('tf-pg').click()
  await win.getByText('Connect', { exact: true }).click()

  // Wait for the schema to appear, but do NOT expand it.
  await expect(win.getByText('app', { exact: true })).toBeVisible({ timeout: 15000 })

  // Typing a filter eagerly loads tables across schemas → the table surfaces.
  await win.getByLabel('filter-tree').fill('orders')
  await expect(win.getByText('orders', { exact: true })).toBeVisible({ timeout: 15000 })

  await app.close()
})

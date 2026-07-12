import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// New schema is a database-level action, so it lives on the DatabaseHeader's
// "⋯" menu (Postgres). Create one from there, see it in the tree, then drop it
// (unique name keeps the run idempotent against the shared Docker Postgres).
test('create then drop a schema from the database header', async () => {
  const schema = `hdr${Date.now()}`
  const userData = mkdtempSync(join(tmpdir(), 'fordb-dbhdr-'))
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()
  win.on('dialog', (d) => void d.accept()) // auto-confirm the DDL previews

  await win.getByText('+ New connection').click()
  await win.getByPlaceholder('Name', { exact: true }).fill('dbhdr-pg')
  await win.getByPlaceholder('Host', { exact: true }).fill('127.0.0.1')
  await win.getByPlaceholder('Port', { exact: true }).fill('54329')
  await win.getByPlaceholder('Database', { exact: true }).fill('fordb_test')
  await win.getByPlaceholder('User', { exact: true }).fill('fordb')
  await win.getByPlaceholder('Password', { exact: true }).fill('fordb')
  await win.getByText('Test & Save').click()
  await win.getByText('dbhdr-pg').click()
  await win.getByText('Connect', { exact: true }).click()
  await expect(win.getByText('app', { exact: true })).toBeVisible({ timeout: 15000 })

  // Create the schema from the database header's "⋯" menu.
  await win.getByLabel('database-actions').click()
  await win.getByText('New schema…', { exact: true }).click()
  await win.getByLabel('new-schema-name').fill(schema)
  await win.getByText('Create', { exact: true }).click()
  await expect(win.getByText(schema, { exact: true })).toBeVisible({ timeout: 15000 })

  // Drop it via the schema node's menu.
  await win.getByText(schema, { exact: true }).click({ button: 'right' })
  await win.getByText('Drop schema…', { exact: true }).click()
  await expect(win.getByText(schema, { exact: true })).toHaveCount(0, { timeout: 15000 })

  await app.close()
})

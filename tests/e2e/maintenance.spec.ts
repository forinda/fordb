import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'

// Table maintenance runs via the tree context menu against the Docker Postgres.
test('run ANALYZE on a table from the schema tree', async () => {
  const schema = `maint_${Date.now()}`
  const seed = new pg.Client({
    host: '127.0.0.1',
    port: 54329,
    database: 'fordb_test',
    user: 'fordb',
    password: 'fordb'
  })
  await seed.connect()
  await seed.query(`CREATE SCHEMA "${schema}"`)
  await seed.query(`CREATE TABLE "${schema}".widgets (id int)`)
  await seed.end()

  const userData = mkdtempSync(join(tmpdir(), 'fordb-maint-'))
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()
  win.on('dialog', (d) => void d.accept()) // the "Run maintenance?" confirm

  await win.getByText('+ New connection').click()
  await win.getByPlaceholder('Name', { exact: true }).fill('maint-pg')
  await win.getByPlaceholder('Host', { exact: true }).fill('127.0.0.1')
  await win.getByPlaceholder('Port', { exact: true }).fill('54329')
  await win.getByPlaceholder('Database', { exact: true }).fill('fordb_test')
  await win.getByPlaceholder('User', { exact: true }).fill('fordb')
  await win.getByPlaceholder('Password', { exact: true }).fill('fordb')
  await win.getByText('Test & Save').click()
  await win.getByText('maint-pg').click()
  await win.getByText('Connect', { exact: true }).click()

  // Expand the seeded schema → its table, then right-click for the menu.
  await win.getByText(schema, { exact: true }).click()
  await win.getByText('widgets', { exact: true }).click({ button: 'right' })
  await win.getByText('Analyze', { exact: true }).click()

  // No error banner appeared (ANALYZE succeeded).
  await win.waitForTimeout(1000)
  await expect(win.locator('.text-destructive')).toHaveCount(0)
  await app.close()

  const verify = new pg.Client({
    host: '127.0.0.1',
    port: 54329,
    database: 'fordb_test',
    user: 'fordb',
    password: 'fordb'
  })
  await verify.connect()
  await verify.query(`DROP SCHEMA "${schema}" CASCADE`)
  await verify.end()
})

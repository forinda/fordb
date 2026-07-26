import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'

// A sequence/materialized view node must be right-clickable so its Drop/Refresh
// menu is reachable (previously they weren't treated as leaf objects, so the
// menu never opened). Seed a sequence directly, then drop it from the tree.
test('drop a sequence from the tree menu', async () => {
  const seq = `e2eseq${Date.now()}`
  const client = new pg.Client({
    host: '127.0.0.1',
    port: 54329,
    database: 'fordb_test',
    user: 'fordb',
    password: 'fordb'
  })
  await client.connect()
  await client.query(`CREATE SEQUENCE app.${seq}`)

  const userData = mkdtempSync(join(tmpdir(), 'fordb-seqdrop-'))
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()
  win.on('dialog', (d) => void d.accept()) // auto-confirm the DROP preview

  await win.getByText('+ New connection').click()
  await win.getByPlaceholder('Name', { exact: true }).fill('seqdrop-pg')
  await win.getByPlaceholder('Host', { exact: true }).fill('127.0.0.1')
  await win.getByPlaceholder('Port', { exact: true }).fill('54329')
  await win.getByPlaceholder('Database', { exact: true }).fill('fordb_test')
  await win.getByPlaceholder('User', { exact: true }).fill('fordb')
  await win.getByPlaceholder('Password', { exact: true }).fill('fordb')
  await win.getByText('Test & Save').click()
  await win.getByText('seqdrop-pg').click()
  await win.getByText('Connect', { exact: true }).click()

  await win.getByText('app', { exact: true }).click() // expand schema
  await win.getByText('Sequences', { exact: true }).click() // expand the Sequences folder
  await win.getByText(seq, { exact: true }).click({ button: 'right' })
  // The Drop entry is only reachable if the sequence node opens the object menu.
  await win.getByText('Drop sequence…', { exact: true }).click()
  await expect(win.getByText(seq, { exact: true })).toHaveCount(0, { timeout: 15000 })

  // Confirm it's really gone server-side.
  const { rows } = await client.query(
    `SELECT 1 FROM pg_sequences WHERE schemaname='app' AND sequencename=$1`,
    [seq]
  )
  expect(rows).toHaveLength(0)

  await client.end()
  await app.close()
})

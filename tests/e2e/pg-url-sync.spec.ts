import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The Postgres connection URL and the discrete fields are two views of one
// connection (like the Mongo URI) — editing either keeps the other in sync,
// and nothing is thrown away. No DB connection needed; this is pure form state.
test('postgres connection URL and fields stay two-way synced', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'fordb-urlsync-'))
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  const urlField = win.getByLabel('Connection URL')
  const host = win.getByPlaceholder('Host', { exact: true })
  const port = win.getByPlaceholder('Port', { exact: true })
  const db = win.getByPlaceholder('Database', { exact: true })
  const user = win.getByPlaceholder('User', { exact: true })

  // URL → fields.
  await urlField.fill('postgres://bob:secret@dbhost:6000/mydb')
  await expect(host).toHaveValue('dbhost')
  await expect(port).toHaveValue('6000')
  await expect(db).toHaveValue('mydb')
  await expect(user).toHaveValue('bob')

  // fields → URL (credentials preserved, not thrown away).
  await host.fill('newhost')
  await expect(urlField).toHaveValue('postgresql://bob:secret@newhost:6000/mydb')

  await app.close()
})

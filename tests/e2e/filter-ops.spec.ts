import { test, expect, _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The filter bar is plain DOM (not canvas), so we can drive a new operator and
// assert the browse re-runs with the expected SQL.
test('startsWith filter re-browses with a LIKE clause', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fordb-filt-')), 'f.sqlite')
  const seed = createClient({ url: `file:${file}` })
  await seed.executeMultiple(
    `CREATE TABLE widgets (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO widgets (label) VALUES ('apple'), ('banana');`
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
  await win.getByPlaceholder('Name', { exact: true }).fill('filt-sqlite')
  await win.getByPlaceholder('File', { exact: true }).fill(file)
  await win.getByText('Test & Save').click()
  await win.getByText('filt-sqlite').click()
  await win.getByText('Connect', { exact: true }).click()
  await win.getByText('main', { exact: true }).click()
  await win.getByText('widgets').dblclick()
  await expect(win.getByText('+ Row')).toBeVisible({ timeout: 15000 })

  await win.getByLabel('filter-column').selectOption('label')
  await win.getByLabel('filter-op').selectOption('startsWith')
  await win.getByLabel('filter-value').fill('app')
  await win.getByText('Apply', { exact: true }).click()

  // The browse SQL line reflects the LIKE clause the new operator generated.
  await expect(win.getByText(/WHERE "label" LIKE .* ESCAPE/)).toBeVisible({ timeout: 5000 })
  await app.close()
})

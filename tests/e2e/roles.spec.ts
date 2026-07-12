import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Full role lifecycle against the Docker Postgres: create a role via the form,
// confirm the masked-password preview, apply, see it in the list, then drop it
// (unique name keeps the run idempotent against the shared DB).
test('create then drop a role through the dashboard', async () => {
  const role = `e2erole${Date.now()}`
  const userData = mkdtempSync(join(tmpdir(), 'fordb-roles-'))
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  const win = await app.firstWindow()

  await win.getByText('+ New connection').click()
  await win.getByPlaceholder('Name', { exact: true }).fill('roles-pg')
  await win.getByPlaceholder('Host', { exact: true }).fill('127.0.0.1')
  await win.getByPlaceholder('Port', { exact: true }).fill('54329')
  await win.getByPlaceholder('Database', { exact: true }).fill('fordb_test')
  await win.getByPlaceholder('User', { exact: true }).fill('fordb')
  await win.getByPlaceholder('Password', { exact: true }).fill('fordb')
  await win.getByText('Test & Save').click()
  await win.getByText('roles-pg').click()
  await win.getByText('Connect', { exact: true }).click()

  await win.getByText('Dashboard', { exact: true }).click()
  await win.getByRole('button', { name: 'roles' }).click()

  // Create.
  await win.getByText('+ New role').click()
  const form = win.getByRole('dialog')
  await form.getByRole('textbox').first().fill(role)
  await form.getByText('Can log in').click()
  await form.locator('input[type=password]').fill('secretpw')
  await form.getByText('Review', { exact: true }).click()

  const preview = win.getByRole('dialog')
  await expect(preview.locator('pre')).toContainText(`CREATE ROLE "${role}"`)
  await expect(preview.locator('pre')).toContainText(`PASSWORD '****'`) // masked, not the real pw
  await expect(preview.locator('pre')).not.toContainText('secretpw')
  await preview.getByText('Apply', { exact: true }).click()

  // Appears in the role list.
  await expect(win.getByText(role)).toBeVisible({ timeout: 10000 })

  // Drop it (cleanup + exercises DROP).
  await win.getByText(role).click()
  await win.getByText(`Drop ${role}`).click()
  await win.getByRole('dialog').getByText('Apply', { exact: true }).click()
  await expect(win.getByText(role)).toHaveCount(0, { timeout: 10000 })

  await app.close()
})

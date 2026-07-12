import { defineConfig } from '@playwright/test'

// Headless CI has no OS keyring, so safeStorage can't encrypt and secret-bearing
// connection profiles (Postgres password, SQLite auth token) fail to save. This
// flag makes the main process use a plaintext test keychain instead — double
// gated in ipc.ts so it can only take effect in an unpackaged build. Specs spread
// `...process.env` into their electron.launch, so setting it here reaches each.
process.env.FORDB_E2E_INSECURE_KEYCHAIN = '1'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  // Each test boots a full Electron app; parallel instances on one machine
  // contend for CPU/display and flake on cold-start. Serialize.
  workers: 1,
  use: { headless: true }
})

import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  // Each test boots a full Electron app; parallel instances on one machine
  // contend for CPU/display and flake on cold-start. Serialize.
  workers: 1,
  use: { headless: true }
})

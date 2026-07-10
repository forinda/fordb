import { _electron as electron } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

const COLD_START_MAX_MS = 4000
const IDLE_RSS_MAX_MB = 400

const t0 = Date.now()
const app = await electron.launch({
  args: ['out/main/index.js'],
  env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
})
const win = await app.firstWindow()
await win.waitForFunction(() => typeof window.fordb !== 'undefined', null, { timeout: 15000 })
const coldStartMs = Date.now() - t0

await new Promise((r) => setTimeout(r, 3000)) // settle
const pid = app.process().pid
const rssKb = Number(
  readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)?.[1] ?? '0'
)
const idleRssMb = Math.round(rssKb / 1024)
await app.close()

const result = { coldStartMs, idleRssMb, at: new Date().toISOString() }
writeFileSync('perf-results.json', JSON.stringify(result, null, 2))
console.log(`cold start: ${coldStartMs} ms | idle RSS: ${idleRssMb} MB`)

if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### fordb perf\n\n| metric | value | budget |\n| --- | --- | --- |\n` +
      `| cold start | ${coldStartMs} ms | ${COLD_START_MAX_MS} ms |\n` +
      `| idle RSS | ${idleRssMb} MB | ${IDLE_RSS_MAX_MB} MB |\n`,
    { flag: 'a' }
  )
}

if (coldStartMs > COLD_START_MAX_MS || idleRssMb > IDLE_RSS_MAX_MB) {
  console.error('perf budget exceeded')
  process.exit(1)
}

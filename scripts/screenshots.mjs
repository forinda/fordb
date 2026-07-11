// Capture landing-site screenshots by driving the real app via Playwright's
// Electron harness (same approach as tests/e2e). Seeds a small SQLite DB so the
// schema tree, query results, and designer look real. Needs a display (xvfb in
// CI, or a live DISPLAY locally) and a prior `pnpm build`.
import { _electron as electron } from '@playwright/test'
import { createClient } from '@libsql/client'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = 'website/public/screenshots'
mkdirSync(OUT, { recursive: true })

const file = join(mkdtempSync(join(tmpdir(), 'fordb-shot-')), 'shop.sqlite')
const db = createClient({ url: `file:${file}` })
await db.executeMultiple(`
  CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT);
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    total NUMERIC,
    placed_at TEXT
  );
  INSERT INTO customers (name, email) VALUES
    ('Ada Lovelace','ada@example.com'),('Alan Turing','alan@example.com'),
    ('Grace Hopper','grace@example.com'),('Katherine Johnson','kj@example.com');
  INSERT INTO orders (customer_id, total, placed_at) VALUES
    (1, 42.50, '2026-01-04'),(1, 19.00, '2026-02-11'),
    (2, 8.75, '2026-02-14'),(3, 120.00, '2026-03-02'),(4, 63.20, '2026-03-19');
`)
db.close()

const userData = mkdtempSync(join(tmpdir(), 'fordb-ud-'))
const app = await electron.launch({
  args: ['out/main/index.js', `--user-data-dir=${userData}`],
  env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
})
const win = await app.firstWindow()
await win.waitForFunction(() => typeof window.fordb !== 'undefined', null, { timeout: 15000 })

// Configure a connection to the seeded SQLite DB.
await win.getByText('+ New connection').click()
await win.getByRole('radio', { name: 'SQLite' }).click()
await win.getByPlaceholder('Name', { exact: true }).fill('Storefront')
await win.getByPlaceholder('File', { exact: true }).fill(file)
await win.getByText('Test & Save').click()

// 1) Connection manager — the saved connection card.
await win.getByText('Storefront').first().waitFor({ timeout: 15000 })
await new Promise((r) => setTimeout(r, 400))
await win.screenshot({ path: join(OUT, 'connections.png') })

await win.getByText('Storefront').first().click()
await win.getByText('Connect', { exact: true }).click()

await win.getByText('main', { exact: true }).click()
await win.getByText('orders').first().waitFor({ timeout: 15000 })

// 2) Browse grid — single-click a table node opens its data tab (do this before
// typing any SQL so the tree "orders" node is the first match).
await win.getByText('orders').first().click()
await new Promise((r) => setTimeout(r, 900))
await win.screenshot({ path: join(OUT, 'browse.png') })

// 3) Query workbench with results.
await win.getByText('Query 1').first().click()
await win.locator('.cm-content').click()
await win.keyboard.type(
  'SELECT c.name, count(*) AS orders, round(sum(o.total),2) AS spent\n' +
    'FROM orders o JOIN customers c ON c.id = o.customer_id\n' +
    'GROUP BY c.name ORDER BY spent DESC'
)
await win.getByText('Run', { exact: true }).click()
await win.getByText(/rows/).waitFor({ timeout: 15000 })
await new Promise((r) => setTimeout(r, 500))
await win.screenshot({ path: join(OUT, 'query.png') })

// 2) Create Table designer (the new feature) — right-click the schema node.
await win.getByText('main', { exact: true }).click({ button: 'right' })
const newTable = win.getByText('New table…')
if (await newTable.isVisible().catch(() => false)) {
  await newTable.click()
  await win.getByLabel('table-name').fill('line_items')
  await win.getByLabel('col-name').fill('id')
  await win.getByLabel('col-type').fill('INTEGER')
  await new Promise((r) => setTimeout(r, 400))
  await win.screenshot({ path: join(OUT, 'designer.png') })
  await win.keyboard.press('Escape')
}

await app.close()
console.log('screenshots written to', OUT)

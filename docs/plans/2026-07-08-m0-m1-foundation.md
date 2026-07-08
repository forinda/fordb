# fordb M0+M1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Runnable three-process Electron skeleton (M0) plus the `DbAdapter` contract, MessagePort RPC layer, and a PostgresAdapter passing a reusable contract test suite against real Postgres (M1).

**Architecture:** Electron with three processes — renderer (React, no Node), main (windows only), and a `db-host` utilityProcess that owns all DB drivers. A transport-agnostic RPC layer (works over Node `MessageChannel` in tests and Electron `MessagePortMain` in production) exposes the same `DbAdapter` TypeScript interface on both sides of the process boundary. The contract test suite is engine-agnostic so SQLite (M6) and future engines must pass the identical tests.

**Tech Stack:** pnpm, TypeScript (strict), electron-vite, Electron ~39, React 18, vitest, pg 8.x + pg-cursor, Docker (postgres:16-alpine) for contract tests.

## Global Constraints

- Package manager: pnpm. Node >= 22.
- TypeScript `strict: true` everywhere; no `any` except at RPC serialization boundaries (typed as `unknown`).
- License: MIT. Product name: **fordb**. App id: `com.forinda.fordb`.
- Renderer never imports Node built-ins or drivers (`nodeIntegration: false`, `contextIsolation: true`).
- Dependencies limited to those named in this plan — anything else needs a plan change.
- Every task ends with a passing verify command and a commit.
- Contract test DB: localhost:54329, user/password/db = `fordb`/`fordb`/`fordb_test` (docker compose file in Task 6).

## File Structure (end state)

```
package.json, pnpm-lock.yaml, electron.vite.config.ts
tsconfig.json, tsconfig.node.json, tsconfig.web.json
eslint.config.mjs, .prettierrc.json, .gitignore, LICENSE, README.md
docker-compose.test.yml
.github/workflows/ci.yml
src/
  shared/
    adapter/types.ts          # ConnectionProfile, QueryResult, ColumnInfo, ...
    adapter/db-adapter.ts     # DbAdapter interface
    rpc/protocol.ts           # RpcRequest/RpcResponse, PortLike
    rpc/client.ts             # createRpcClient<T>()
    rpc/server.ts             # serveRpc(port, target)
  main/index.ts               # BrowserWindow + spawn db-host, port plumbing
  preload/index.ts            # contextBridge
  renderer/index.html
  renderer/src/main.tsx
  renderer/src/App.tsx
  db-host/index.ts            # utilityProcess entry: serve adapters
  db-host/postgres/postgres-adapter.ts
  db-host/postgres/introspection-sql.ts
tests/
  unit/rpc.test.ts
  contract/adapter-contract.ts        # shared suite (exported function)
  contract/postgres.contract.test.ts  # runs suite against PostgresAdapter
  contract/fixture.sql
```

---

### Task 1: Repo scaffold + electron-vite three-process build

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `.gitignore`, `LICENSE`, `README.md`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/db-host/index.ts`

**Interfaces:**
- Produces: `pnpm dev` (runs app), `pnpm build` (typecheck+bundle), `pnpm typecheck`. Directory conventions above — later tasks add files under `src/shared`, `src/db-host`.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "fordb",
  "version": "0.0.1",
  "description": "Lean, keyboard-first, multi-engine database client",
  "license": "MIT",
  "private": true,
  "main": "out/main/index.js",
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "pnpm typecheck && electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
pnpm add -D electron@^39.0.0 electron-vite@^4.0.0 vite@^7.0.0 typescript@^5.8.0 @vitejs/plugin-react@^5.0.0
pnpm add react@^18.3.0 react-dom@^18.3.0
pnpm add -D @types/react@^18.3.0 @types/react-dom@^18.3.0 @types/node@^22.0.0
```
Expected: lockfile created, no peer warnings that block install.

- [ ] **Step 3: Write electron.vite.config.ts**

```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'db-host': resolve(__dirname, 'src/db-host/index.ts')
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    },
    plugins: [react()]
  }
})
```

Note: db-host is bundled as a second entry of the main-process build — utilityProcess code runs in Node, same build target as main.

- [ ] **Step 4: Write tsconfigs**

`tsconfig.json`:
```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/db-host/**/*", "src/shared/**/*", "tests/**/*", "electron.vite.config.ts"]
}
```

`tsconfig.web.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"]
  },
  "include": ["src/renderer/src/**/*", "src/shared/**/*", "src/preload/**/*"]
}
```

- [ ] **Step 5: Write minimal process entries**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
```

`src/preload/index.ts`:
```ts
// Populated in Task 3 (port plumbing). Must exist for the build.
export {}
```

`src/db-host/index.ts`:
```ts
// utilityProcess entry. Populated in Task 3.
process.parentPort?.on('message', () => {})
```

`src/renderer/index.html`:
```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>fordb</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

`src/renderer/src/App.tsx`:
```tsx
export function App(): React.JSX.Element {
  return <h1>fordb</h1>
}
```

- [ ] **Step 6: Write .gitignore, LICENSE (MIT, "Copyright (c) 2026 Forinda"), README.md**

`.gitignore`:
```
node_modules/
out/
dist/
*.local
```

`README.md`:
```markdown
# fordb

Lean, keyboard-first, open-source desktop database client.
PostgreSQL → SQLite → MongoDB. All engines free.

Docs: see `docs/`. Dev: `pnpm install && pnpm dev`.
```

- [ ] **Step 7: Verify**

Run: `pnpm typecheck && pnpm build`
Expected: both succeed, `out/main/index.js`, `out/main/db-host.js`, `out/preload/index.js` exist.
Run: `pnpm dev` — a window titled fordb opens showing "fordb". Close it.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: electron-vite three-process scaffold"
```

---

### Task 2: Lint, format, unit-test tooling

**Files:**
- Create: `eslint.config.mjs`, `.prettierrc.json`, `vitest.config.ts`, `tests/unit/smoke.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: `pnpm lint`, `pnpm test` commands used by CI (Task 4) and all later tasks.

- [ ] **Step 1: Install**

```bash
pnpm add -D eslint@^9.0.0 typescript-eslint@^8.0.0 prettier@^3.0.0 vitest@^3.0.0
```

- [ ] **Step 2: Write eslint.config.mjs**

```js
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/', 'dist/', 'node_modules/'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }]
    }
  }
)
```

- [ ] **Step 3: Write .prettierrc.json**

```json
{ "semi": false, "singleQuote": true, "printWidth": 100, "trailingComma": "none" }
```

- [ ] **Step 4: Write vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node'
  }
})
```

Contract tests get their own config in Task 6 (they need Docker; keep `pnpm test` fast).

- [ ] **Step 5: Write failing smoke test, watch it pass**

`tests/unit/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 6: Add scripts to package.json**

```json
"lint": "eslint . && prettier --check .",
"format": "prettier --write .",
"test": "vitest run"
```

- [ ] **Step 7: Verify**

Run: `pnpm format && pnpm lint && pnpm test`
Expected: lint clean, 1 test passes.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: eslint, prettier, vitest tooling"
```

---

### Task 3: db-host utilityProcess wiring (ping-pong proof)

**Files:**
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/db-host/index.ts`, `src/renderer/src/App.tsx`

**Interfaces:**
- Produces: renderer ↔ db-host MessagePort pipeline. Renderer obtains a `MessagePort` via `window.fordb.getDbHostPort(): Promise<MessagePort>`. Task 8 reuses this exact pipeline for the RPC client.

- [ ] **Step 1: Spawn db-host from main and forward a port**

Replace `src/main/index.ts`:
```ts
import { app, BrowserWindow, ipcMain, utilityProcess, MessageChannelMain } from 'electron'
import { join } from 'node:path'

let dbHost: Electron.UtilityProcess | null = null

function startDbHost(): void {
  dbHost = utilityProcess.fork(join(__dirname, 'db-host.js'), [], { serviceName: 'fordb-db-host' })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('db-host:request-port', (event) => {
  const { port1, port2 } = new MessageChannelMain()
  dbHost?.postMessage({ type: 'new-client' }, [port1])
  event.sender.postMessage('db-host:port', null, [port2])
})

void app.whenReady().then(() => {
  startDbHost()
  createWindow()
})
app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 2: Preload bridge**

Replace `src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('fordb', {
  getDbHostPort: (): Promise<MessagePort> =>
    new Promise((resolve) => {
      ipcRenderer.once('db-host:port', (event) => {
        const port = event.ports[0]
        if (port) resolve(port)
      })
      void ipcRenderer.invoke('db-host:request-port')
    })
})
```

- [ ] **Step 3: db-host answers ping**

Replace `src/db-host/index.ts`:
```ts
process.parentPort.on('message', (e) => {
  const [port] = e.ports
  if (!port) return
  port.on('message', (msg) => {
    if ((msg.data as { type?: string }).type === 'ping') {
      port.postMessage({ type: 'pong' })
    }
  })
  port.start()
})
```

- [ ] **Step 4: Renderer proves the pipeline**

Replace `src/renderer/src/App.tsx`:
```tsx
import { useEffect, useState } from 'react'

declare global {
  interface Window {
    fordb: { getDbHostPort: () => Promise<MessagePort> }
  }
}

export function App(): React.JSX.Element {
  const [status, setStatus] = useState('connecting to db-host…')
  useEffect(() => {
    void window.fordb.getDbHostPort().then((port) => {
      port.onmessage = (e): void => {
        if ((e.data as { type?: string }).type === 'pong') setStatus('db-host: pong')
      }
      port.postMessage({ type: 'ping' })
    })
  }, [])
  return <h1>fordb — {status}</h1>
}
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm dev`
Expected: window shows "fordb — db-host: pong".

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: db-host utility process with renderer MessagePort pipeline"
```

---

### Task 4: CI workflow (lint + unit tests)

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: CI job names `lint-test` (Task 10 adds the `contract` job to this same file).

- [ ] **Step 1: Write workflow**

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  lint-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
```

- [ ] **Step 2: Verify locally**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all pass (same commands CI runs).

- [ ] **Step 3: Commit**

```bash
git add .github && git commit -m "ci: lint, typecheck, unit tests"
```

---

### Task 5: Shared adapter types + DbAdapter interface

**Files:**
- Create: `src/shared/adapter/types.ts`, `src/shared/adapter/db-adapter.ts`

**Interfaces:**
- Produces (used by every later task — exact shapes):

- [ ] **Step 1: Write types.ts**

```ts
export interface SslOptions {
  ca?: string
  cert?: string
  key?: string
  rejectUnauthorized: boolean
}

export interface ConnectionProfile {
  id: string
  name: string
  engine: 'postgres'
  host: string
  port: number
  database: string
  user: string
  password?: string
  ssl?: SslOptions
}

export interface TableInfo {
  schema: string
  name: string
  type: 'table' | 'view'
}

export interface ColumnInfo {
  name: string
  dataType: string
  nullable: boolean
  defaultValue: string | null
  ordinal: number
}

export interface KeyInfo {
  name: string
  kind: 'primary' | 'foreign' | 'unique'
  columns: string[]
  referencedTable: string | null
}

export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
}

export interface FieldInfo {
  name: string
  dataType: string
}

export interface QueryResult {
  fields: FieldInfo[]
  rows: unknown[][]
  rowCount: number
  command: string
}

export interface OpenQueryResult {
  queryId: string
  fields: FieldInfo[]
}

export interface Page {
  rows: unknown[][]
  done: boolean
}
```

- [ ] **Step 2: Write db-adapter.ts**

```ts
import type {
  ColumnInfo,
  ConnectionProfile,
  IndexInfo,
  KeyInfo,
  OpenQueryResult,
  Page,
  QueryResult,
  TableInfo
} from './types'

/**
 * Contract implemented by every engine adapter (db-host side) and by the
 * renderer RPC proxy. All methods async + JSON-serializable args/returns:
 * this interface crosses a process boundary.
 */
export interface DbAdapter {
  connect(profile: ConnectionProfile): Promise<void>
  disconnect(): Promise<void>

  listDatabases(): Promise<string[]>
  listSchemas(): Promise<string[]>
  /** Tables AND views for a schema; TableInfo.type distinguishes. */
  listTables(schema: string): Promise<TableInfo[]>
  getColumns(schema: string, table: string): Promise<ColumnInfo[]>
  getKeys(schema: string, table: string): Promise<KeyInfo[]>
  getIndexes(schema: string, table: string): Promise<IndexInfo[]>

  /** Buffered execution — small/interactive statements. */
  executeQuery(sql: string): Promise<QueryResult>

  /** Cursor-backed streaming for large results. */
  openQuery(sql: string, pageSize: number): Promise<OpenQueryResult>
  fetchPage(queryId: string): Promise<Page>
  closeQuery(queryId: string): Promise<void>

  /** Cancel the currently running statement on this connection. */
  cancel(): Promise<void>
}
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/shared && git commit -m "feat: DbAdapter contract and shared types"
```

---

### Task 6: Contract test harness (Docker Postgres + fixture + suite skeleton)

**Files:**
- Create: `docker-compose.test.yml`, `tests/contract/fixture.sql`, `tests/contract/adapter-contract.ts`, `vitest.contract.config.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `DbAdapter`, `ConnectionProfile` from Task 5.
- Produces: `runAdapterContractTests(makeAdapter: () => DbAdapter, profile: ConnectionProfile): void` — Task 7/9 call this; M6's SQLite adapter reuses it. Script `pnpm test:contract`.

- [ ] **Step 1: Write docker-compose.test.yml**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: fordb
      POSTGRES_PASSWORD: fordb
      POSTGRES_DB: fordb_test
    ports:
      - '54329:5432'
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U fordb -d fordb_test']
      interval: 2s
      timeout: 2s
      retries: 15
```

- [ ] **Step 2: Write tests/contract/fixture.sql**

```sql
DROP SCHEMA IF EXISTS app CASCADE;
CREATE SCHEMA app;

CREATE TABLE app.users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.orders (
  id serial PRIMARY KEY,
  user_id int NOT NULL REFERENCES app.users (id),
  amount numeric(10, 2) NOT NULL
);

CREATE INDEX orders_user_id_idx ON app.orders (user_id);

CREATE VIEW app.user_emails AS
SELECT id, email FROM app.users;

INSERT INTO app.users (email, name)
SELECT 'user' || i || '@example.com', 'User ' || i
FROM generate_series(1, 1000) AS i;

INSERT INTO app.orders (user_id, amount)
SELECT ((i - 1) % 1000) + 1, (i % 500)::numeric / 10
FROM generate_series(1, 5000) AS i;
```

- [ ] **Step 3: Write the shared contract suite**

`tests/contract/adapter-contract.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { DbAdapter } from '../../src/shared/adapter/db-adapter'
import type { ConnectionProfile } from '../../src/shared/adapter/types'

/**
 * Engine-agnostic adapter contract. Every engine adapter must pass this
 * suite unchanged. Fixture expectations: schema `app` with tables
 * users(1000 rows)/orders(5000 rows), view user_emails, FK orders→users,
 * index orders_user_id_idx.
 */
export function runAdapterContractTests(
  makeAdapter: () => DbAdapter,
  profile: ConnectionProfile
): void {
  describe('DbAdapter contract', () => {
    let adapter: DbAdapter

    beforeAll(async () => {
      adapter = makeAdapter()
      await adapter.connect(profile)
    })

    afterAll(async () => {
      await adapter.disconnect()
    })

    it('lists databases including the connected one', async () => {
      const dbs = await adapter.listDatabases()
      expect(dbs).toContain(profile.database)
    })

    it('lists schemas including app', async () => {
      const schemas = await adapter.listSchemas()
      expect(schemas).toContain('app')
    })

    it('lists tables and views with type flag', async () => {
      const tables = await adapter.listTables('app')
      const names = tables.map((t) => `${t.type}:${t.name}`)
      expect(names).toContain('table:users')
      expect(names).toContain('table:orders')
      expect(names).toContain('view:user_emails')
    })

    it('describes columns with nullability and defaults', async () => {
      const cols = await adapter.getColumns('app', 'users')
      const email = cols.find((c) => c.name === 'email')
      const name = cols.find((c) => c.name === 'name')
      expect(email?.nullable).toBe(false)
      expect(name?.nullable).toBe(true)
      const createdAt = cols.find((c) => c.name === 'created_at')
      expect(createdAt?.defaultValue).toBeTruthy()
      expect(cols.map((c) => c.ordinal)).toEqual([...cols.map((c) => c.ordinal)].sort((a, b) => a - b))
    })

    it('reports primary, foreign, and unique keys', async () => {
      const userKeys = await adapter.getKeys('app', 'users')
      expect(userKeys.some((k) => k.kind === 'primary' && k.columns.includes('id'))).toBe(true)
      expect(userKeys.some((k) => k.kind === 'unique' && k.columns.includes('email'))).toBe(true)
      const orderKeys = await adapter.getKeys('app', 'orders')
      const fk = orderKeys.find((k) => k.kind === 'foreign')
      expect(fk?.columns).toContain('user_id')
      expect(fk?.referencedTable).toBe('users')
    })

    it('reports indexes', async () => {
      const idx = await adapter.getIndexes('app', 'orders')
      const byName = idx.find((i) => i.name === 'orders_user_id_idx')
      expect(byName?.columns).toEqual(['user_id'])
      expect(byName?.unique).toBe(false)
    })

    it('executes a buffered query with fields and rows', async () => {
      const r = await adapter.executeQuery('SELECT id, email FROM app.users ORDER BY id LIMIT 3')
      expect(r.fields.map((f) => f.name)).toEqual(['id', 'email'])
      expect(r.rows).toHaveLength(3)
      expect(r.rowCount).toBe(3)
      expect(r.rows[0]?.[1]).toBe('user1@example.com')
    })

    it('streams large results in pages until done', async () => {
      const open = await adapter.openQuery('SELECT id FROM app.orders ORDER BY id', 1000)
      expect(open.fields.map((f) => f.name)).toEqual(['id'])
      let total = 0
      let pages = 0
      for (;;) {
        const page = await adapter.fetchPage(open.queryId)
        total += page.rows.length
        pages += 1
        if (page.done) break
        expect(pages).toBeLessThan(20) // safety against infinite loop
      }
      await adapter.closeQuery(open.queryId)
      expect(total).toBe(5000)
      expect(pages).toBeGreaterThanOrEqual(5)
    })

    it('closeQuery frees the cursor early without error', async () => {
      const open = await adapter.openQuery('SELECT id FROM app.orders', 100)
      await adapter.fetchPage(open.queryId)
      await expect(adapter.closeQuery(open.queryId)).resolves.toBeUndefined()
    })

    it('cancel interrupts a running statement', async () => {
      const slow = adapter.executeQuery('SELECT pg_sleep(30)')
      await new Promise((r) => setTimeout(r, 300))
      await adapter.cancel()
      await expect(slow).rejects.toThrow(/cancel/i)
    }, 15000)

    it('rejects bad SQL with a useful error', async () => {
      await expect(adapter.executeQuery('SELEKT 1')).rejects.toThrow(/syntax/i)
    })
  })
}
```

Note: the `cancel` test uses `pg_sleep`, which is Postgres-specific. When M6 adds SQLite, move this test behind a `capabilities.cancel` flag — noted here so the future engineer knows the suite owns that decision, not the adapter.

- [ ] **Step 4: Write vitest.contract.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/contract/**/*.contract.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false
  }
})
```

- [ ] **Step 5: Add scripts**

In `package.json`:
```json
"db:up": "docker compose -f docker-compose.test.yml up -d --wait",
"db:down": "docker compose -f docker-compose.test.yml down -v",
"test:contract": "vitest run -c vitest.contract.config.ts"
```

- [ ] **Step 6: Verify harness compiles and docker works**

Run: `pnpm db:up && pnpm typecheck && pnpm test:contract`
Expected: docker healthy; typecheck clean; vitest reports "no test files found" exit 0? — vitest exits 1 on no tests, so instead expected: "No test files found" — acceptable at this task; Task 7 adds the test file. If exit code blocks, append `--passWithNoTests` to the script.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "test: engine-agnostic adapter contract suite and postgres test harness"
```

---

### Task 7: PostgresAdapter — connection + introspection

**Files:**
- Create: `src/db-host/postgres/postgres-adapter.ts`, `src/db-host/postgres/introspection-sql.ts`, `tests/contract/postgres.contract.test.ts`

**Interfaces:**
- Consumes: `DbAdapter` + all types (Task 5), contract suite + fixture (Task 6).
- Produces: `class PostgresAdapter implements DbAdapter` with constructor `new PostgresAdapter()` — Task 9 registers it in db-host.

- [ ] **Step 1: Install driver**

```bash
pnpm add pg@^8.22.0 pg-cursor@^2.21.0
pnpm add -D @types/pg@^8.15.0 @types/pg-cursor@^2.7.0
```

- [ ] **Step 2: Write the contract test file (it will fail — adapter missing)**

`tests/contract/postgres.contract.test.ts`:
```ts
import { runAdapterContractTests } from './adapter-contract'
import { PostgresAdapter } from '../../src/db-host/postgres/postgres-adapter'
import type { ConnectionProfile } from '../../src/shared/adapter/types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll } from 'vitest'
import pg from 'pg'

const profile: ConnectionProfile = {
  id: 'test',
  name: 'contract-test',
  engine: 'postgres',
  host: '127.0.0.1',
  port: 54329,
  database: 'fordb_test',
  user: 'fordb',
  password: 'fordb'
}

beforeAll(async () => {
  const client = new pg.Client({
    host: profile.host,
    port: profile.port,
    database: profile.database,
    user: profile.user,
    password: profile.password
  })
  await client.connect()
  await client.query(readFileSync(join(__dirname, 'fixture.sql'), 'utf8'))
  await client.end()
})

runAdapterContractTests(() => new PostgresAdapter(), profile)
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm db:up && pnpm test:contract`
Expected: FAIL — cannot resolve `postgres-adapter`.

- [ ] **Step 4: Write introspection SQL constants**

`src/db-host/postgres/introspection-sql.ts`:
```ts
export const LIST_DATABASES = `
  SELECT datname FROM pg_database
  WHERE datallowconn AND NOT datistemplate
  ORDER BY datname`

export const LIST_SCHEMAS = `
  SELECT nspname FROM pg_namespace
  WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
  ORDER BY nspname`

export const LIST_TABLES = `
  SELECT table_name AS name,
         CASE table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END AS type
  FROM information_schema.tables
  WHERE table_schema = $1
  ORDER BY table_name`

export const GET_COLUMNS = `
  SELECT column_name AS name,
         data_type AS "dataType",
         is_nullable = 'YES' AS nullable,
         column_default AS "defaultValue",
         ordinal_position AS ordinal
  FROM information_schema.columns
  WHERE table_schema = $1 AND table_name = $2
  ORDER BY ordinal_position`

export const GET_KEYS = `
  SELECT con.conname AS name,
         CASE con.contype WHEN 'p' THEN 'primary' WHEN 'f' THEN 'foreign' ELSE 'unique' END AS kind,
         ARRAY(
           SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
           ORDER BY k.ord
         ) AS columns,
         confrel.relname AS "referencedTable"
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  LEFT JOIN pg_class confrel ON confrel.oid = con.confrelid
  WHERE nsp.nspname = $1 AND rel.relname = $2 AND con.contype IN ('p', 'f', 'u')
  ORDER BY con.conname`

export const GET_INDEXES = `
  SELECT ic.relname AS name,
         ARRAY(
           SELECT a.attname FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
           ORDER BY k.ord
         ) AS columns,
         ix.indisunique AS unique
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN pg_class tc ON tc.oid = ix.indrelid
  JOIN pg_namespace nsp ON nsp.oid = tc.relnamespace
  WHERE nsp.nspname = $1 AND tc.relname = $2 AND NOT ix.indisprimary
  ORDER BY ic.relname`
```

- [ ] **Step 5: Write PostgresAdapter (connection + introspection + buffered query; streaming/cancel throw "not implemented" for now)**

`src/db-host/postgres/postgres-adapter.ts`:
```ts
import pg from 'pg'
import Cursor from 'pg-cursor'
import type { DbAdapter } from '../../shared/adapter/db-adapter'
import type {
  ColumnInfo,
  ConnectionProfile,
  IndexInfo,
  KeyInfo,
  OpenQueryResult,
  Page,
  QueryResult,
  TableInfo
} from '../../shared/adapter/types'
import * as SQL from './introspection-sql'

interface OpenCursor {
  cursor: Cursor
  fields: { name: string; dataType: string }[]
  pageSize: number
}

export class PostgresAdapter implements DbAdapter {
  private client: pg.Client | null = null
  private profile: ConnectionProfile | null = null
  private backendPid: number | null = null
  private cursors = new Map<string, OpenCursor>()
  private nextCursorId = 1

  private get conn(): pg.Client {
    if (!this.client) throw new Error('Not connected')
    return this.client
  }

  private static clientConfig(profile: ConnectionProfile): pg.ClientConfig {
    return {
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.user,
      password: profile.password,
      ssl: profile.ssl
        ? {
            ca: profile.ssl.ca,
            cert: profile.ssl.cert,
            key: profile.ssl.key,
            rejectUnauthorized: profile.ssl.rejectUnauthorized
          }
        : undefined
    }
  }

  async connect(profile: ConnectionProfile): Promise<void> {
    const client = new pg.Client(PostgresAdapter.clientConfig(profile))
    await client.connect()
    const pid = await client.query('SELECT pg_backend_pid() AS pid')
    this.backendPid = (pid.rows[0] as { pid: number }).pid
    this.client = client
    this.profile = profile
  }

  async disconnect(): Promise<void> {
    for (const [id] of this.cursors) await this.closeQuery(id)
    await this.client?.end()
    this.client = null
    this.backendPid = null
  }

  async listDatabases(): Promise<string[]> {
    const r = await this.conn.query(SQL.LIST_DATABASES)
    return r.rows.map((row: { datname: string }) => row.datname)
  }

  async listSchemas(): Promise<string[]> {
    const r = await this.conn.query(SQL.LIST_SCHEMAS)
    return r.rows.map((row: { nspname: string }) => row.nspname)
  }

  async listTables(schema: string): Promise<TableInfo[]> {
    const r = await this.conn.query(SQL.LIST_TABLES, [schema])
    return r.rows.map((row: { name: string; type: 'table' | 'view' }) => ({
      schema,
      name: row.name,
      type: row.type
    }))
  }

  async getColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    const r = await this.conn.query(SQL.GET_COLUMNS, [schema, table])
    return r.rows.map((row: ColumnInfo & { ordinal: string | number }) => ({
      ...row,
      ordinal: Number(row.ordinal)
    }))
  }

  async getKeys(schema: string, table: string): Promise<KeyInfo[]> {
    const r = await this.conn.query(SQL.GET_KEYS, [schema, table])
    return r.rows as KeyInfo[]
  }

  async getIndexes(schema: string, table: string): Promise<IndexInfo[]> {
    const r = await this.conn.query(SQL.GET_INDEXES, [schema, table])
    return r.rows as IndexInfo[]
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    const r = await this.conn.query({ text: sql, rowMode: 'array' })
    return {
      fields: r.fields.map((f) => ({ name: f.name, dataType: String(f.dataTypeID) })),
      rows: r.rows as unknown[][],
      rowCount: r.rowCount ?? r.rows.length,
      command: r.command
    }
  }

  async openQuery(_sql: string, _pageSize: number): Promise<OpenQueryResult> {
    throw new Error('not implemented')
  }

  async fetchPage(_queryId: string): Promise<Page> {
    throw new Error('not implemented')
  }

  async closeQuery(_queryId: string): Promise<void> {
    throw new Error('not implemented')
  }

  async cancel(): Promise<void> {
    throw new Error('not implemented')
  }
}
```

- [ ] **Step 6: Run contract tests — introspection/buffered tests pass, streaming/cancel fail**

Run: `pnpm test:contract`
Expected: PASS for databases/schemas/tables/columns/keys/indexes/buffered query/bad SQL; FAIL only "streams large results", "closeQuery frees", "cancel interrupts".

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: PostgresAdapter connection, introspection, buffered queries"
```

---

### Task 8: PostgresAdapter — cursor streaming + cancel

**Files:**
- Modify: `src/db-host/postgres/postgres-adapter.ts` (replace the four not-implemented methods)

**Interfaces:**
- Consumes: contract suite expectations from Task 6 (pages of `pageSize`, `done` flag, cancel rejects in-flight query with /cancel/i).

- [ ] **Step 1: Implement openQuery/fetchPage/closeQuery**

Replace the three stubs:
```ts
  async openQuery(sql: string, pageSize: number): Promise<OpenQueryResult> {
    const cursor = this.conn.query(new Cursor(sql, [], { rowMode: 'array' }))
    // Prime the cursor with a zero-row read to obtain field metadata.
    await new Promise<void>((resolve, reject) =>
      cursor.read(0, (err) => (err ? reject(err) : resolve()))
    )
    const fields = (cursor as unknown as { _result: { fields: { name: string; dataTypeID: number }[] } })
      ._result.fields.map((f) => ({ name: f.name, dataType: String(f.dataTypeID) }))
    const queryId = `q${this.nextCursorId++}`
    this.cursors.set(queryId, { cursor, fields, pageSize })
    return { queryId, fields }
  }

  async fetchPage(queryId: string): Promise<Page> {
    const open = this.cursors.get(queryId)
    if (!open) throw new Error(`Unknown queryId: ${queryId}`)
    const rows = await new Promise<unknown[][]>((resolve, reject) =>
      open.cursor.read(open.pageSize, (err, r) => (err ? reject(err) : resolve(r as unknown[][])))
    )
    const done = rows.length < open.pageSize
    if (done) await this.closeQuery(queryId)
    return { rows, done }
  }

  async closeQuery(queryId: string): Promise<void> {
    const open = this.cursors.get(queryId)
    if (!open) return
    this.cursors.delete(queryId)
    await new Promise<void>((resolve) => open.cursor.close(() => resolve()))
  }
```

Note: if the `_result` private-field access proves unstable against the installed pg-cursor version, fall back to reading the first page inside `openQuery` (read `pageSize` rows, stash them, take fields from the row-description callback) — the contract suite, not this implementation detail, is the source of truth.

- [ ] **Step 2: Implement cancel via side connection**

```ts
  async cancel(): Promise<void> {
    if (!this.profile || this.backendPid === null) throw new Error('Not connected')
    const side = new pg.Client(PostgresAdapter.clientConfig(this.profile))
    await side.connect()
    try {
      await side.query('SELECT pg_cancel_backend($1)', [this.backendPid])
    } finally {
      await side.end()
    }
  }
```

pg surfaces the server's cancellation as error message "canceling statement due to user request" — matches the suite's `/cancel/i`.

- [ ] **Step 3: Run full contract suite**

Run: `pnpm test:contract`
Expected: ALL tests PASS (11 tests).

- [ ] **Step 4: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: PostgresAdapter cursor streaming and query cancellation"
```

---

### Task 9: RPC layer (protocol, server, client) + db-host registration

**Files:**
- Create: `src/shared/rpc/protocol.ts`, `src/shared/rpc/server.ts`, `src/shared/rpc/client.ts`, `tests/unit/rpc.test.ts`
- Modify: `src/db-host/index.ts`

**Interfaces:**
- Consumes: `DbAdapter` (Task 5), `PostgresAdapter` (Tasks 7-8), port pipeline (Task 3).
- Produces: `createRpcClient<T>(port: PortLike): T`, `serveRpc(port: PortLike, target: object): void`, `PortLike { postMessage(msg: unknown): void; onMessage(cb: (msg: unknown) => void): void }`. Renderer M2+ code calls `createRpcClient<DbAdapter>(...)`.

- [ ] **Step 1: Write failing unit tests**

`tests/unit/rpc.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import { createRpcClient } from '../../src/shared/rpc/client'
import { serveRpc } from '../../src/shared/rpc/server'
import type { PortLike } from '../../src/shared/rpc/protocol'

function nodePort(port: import('node:worker_threads').MessagePort): PortLike {
  return {
    postMessage: (msg) => port.postMessage(msg),
    onMessage: (cb) => port.on('message', cb)
  }
}

interface Calculator {
  add(a: number, b: number): Promise<number>
  fail(): Promise<void>
}

const impl: Calculator = {
  add: (a, b) => Promise.resolve(a + b),
  fail: () => Promise.reject(new Error('boom: ECODE'))
}

function setup(): { client: Calculator; teardown: () => void } {
  const { port1, port2 } = new MessageChannel()
  serveRpc(nodePort(port1), impl)
  const client = createRpcClient<Calculator>(nodePort(port2))
  return { client, teardown: () => (port1.close(), port2.close()) }
}

describe('rpc', () => {
  it('round-trips a method call with args and result', async () => {
    const { client, teardown } = setup()
    await expect(client.add(2, 3)).resolves.toBe(5)
    teardown()
  })

  it('propagates errors with original message', async () => {
    const { client, teardown } = setup()
    await expect(client.fail()).rejects.toThrow('boom: ECODE')
    teardown()
  })

  it('rejects unknown methods', async () => {
    const { client, teardown } = setup()
    await expect(
      (client as unknown as { nope: () => Promise<void> }).nope()
    ).rejects.toThrow(/unknown method/i)
    teardown()
  })

  it('keeps concurrent calls correlated', async () => {
    const { client, teardown } = setup()
    const results = await Promise.all([client.add(1, 1), client.add(2, 2), client.add(3, 3)])
    expect(results).toEqual([2, 4, 6])
    teardown()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write protocol.ts**

```ts
export interface PortLike {
  postMessage(msg: unknown): void
  onMessage(cb: (msg: unknown) => void): void
}

export interface RpcRequest {
  kind: 'rpc-request'
  id: number
  method: string
  args: unknown[]
}

export type RpcResponse =
  | { kind: 'rpc-response'; id: number; ok: true; value: unknown }
  | { kind: 'rpc-response'; id: number; ok: false; error: string }

export function isRpcRequest(msg: unknown): msg is RpcRequest {
  return typeof msg === 'object' && msg !== null && (msg as RpcRequest).kind === 'rpc-request'
}

export function isRpcResponse(msg: unknown): msg is RpcResponse {
  return typeof msg === 'object' && msg !== null && (msg as RpcResponse).kind === 'rpc-response'
}
```

- [ ] **Step 4: Write server.ts**

```ts
import { isRpcRequest, type PortLike, type RpcResponse } from './protocol'

export function serveRpc(port: PortLike, target: object): void {
  port.onMessage((msg) => {
    if (!isRpcRequest(msg)) return
    const respond = (r: RpcResponse): void => port.postMessage(r)
    const fn = (target as Record<string, unknown>)[msg.method]
    if (typeof fn !== 'function') {
      respond({ kind: 'rpc-response', id: msg.id, ok: false, error: `Unknown method: ${msg.method}` })
      return
    }
    void Promise.resolve()
      .then(() => (fn as (...a: unknown[]) => unknown).apply(target, msg.args))
      .then((value) => respond({ kind: 'rpc-response', id: msg.id, ok: true, value }))
      .catch((err: unknown) =>
        respond({
          kind: 'rpc-response',
          id: msg.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      )
  })
}
```

- [ ] **Step 5: Write client.ts**

```ts
import { isRpcResponse, type PortLike, type RpcRequest } from './protocol'

export function createRpcClient<T extends object>(port: PortLike): T {
  let nextId = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  port.onMessage((msg) => {
    if (!isRpcResponse(msg)) return
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (msg.ok) entry.resolve(msg.value)
    else entry.reject(new Error(msg.error))
  })

  return new Proxy({} as T, {
    get(_t, method: string) {
      return (...args: unknown[]): Promise<unknown> =>
        new Promise((resolve, reject) => {
          const id = nextId++
          pending.set(id, { resolve, reject })
          const req: RpcRequest = { kind: 'rpc-request', id, method, args }
          port.postMessage(req)
        })
    }
  })
}
```

- [ ] **Step 6: Run unit tests**

Run: `pnpm test`
Expected: all rpc tests PASS.

- [ ] **Step 7: Register PostgresAdapter in db-host**

Replace `src/db-host/index.ts`:
```ts
import { serveRpc } from '../shared/rpc/server'
import type { PortLike } from '../shared/rpc/protocol'
import { PostgresAdapter } from './postgres/postgres-adapter'

function electronPort(port: Electron.MessagePortMain): PortLike {
  return {
    postMessage: (msg) => port.postMessage(msg),
    onMessage: (cb) => port.on('message', (e) => cb(e.data))
  }
}

process.parentPort.on('message', (e) => {
  const [port] = e.ports
  if (!port) return
  // One adapter instance per renderer client; M2 adds a connection registry.
  serveRpc(electronPort(port), new PostgresAdapter())
  port.start()
})
```

- [ ] **Step 8: Renderer smoke over the real pipeline**

Replace the `useEffect` body in `src/renderer/src/App.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { createRpcClient } from '../../shared/rpc/client'
import type { DbAdapter } from '../../shared/adapter/db-adapter'

declare global {
  interface Window {
    fordb: { getDbHostPort: () => Promise<MessagePort> }
  }
}

export function App(): React.JSX.Element {
  const [status, setStatus] = useState('starting…')
  useEffect(() => {
    void window.fordb.getDbHostPort().then((port) => {
      const adapter = createRpcClient<DbAdapter>({
        postMessage: (msg) => port.postMessage(msg),
        onMessage: (cb) => (port.onmessage = (e): void => cb(e.data))
      })
      port.start()
      // Proves RPC wiring end-to-end; errors expectedly if no local Postgres.
      adapter
        .listDatabases()
        .then((dbs) => setStatus(`databases: ${dbs.join(', ')}`))
        .catch((err: Error) => setStatus(`db-host reachable, connect error: ${err.message}`))
    })
  }, [])
  return <h1>fordb — {status}</h1>
}
```

- [ ] **Step 9: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm dev`
Expected: window shows "db-host reachable, connect error: Not connected" — proving renderer → RPC → db-host → PostgresAdapter round trip (no connection was opened; that's M2's UI).

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: transport-agnostic RPC layer wired renderer to db-host adapter"
```

---

### Task 10: Contract tests in CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `pnpm test:contract` (Task 6), fixture + suite (Tasks 6-8).

- [ ] **Step 1: Add contract job**

Append to `.github/workflows/ci.yml`:
```yaml
  contract:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: fordb
          POSTGRES_PASSWORD: fordb
          POSTGRES_DB: fordb_test
        ports:
          - 54329:5432
        options: >-
          --health-cmd "pg_isready -U fordb -d fordb_test"
          --health-interval 2s --health-timeout 2s --health-retries 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:contract
```

- [ ] **Step 2: Verify locally (same command)**

Run: `pnpm db:up && pnpm test:contract`
Expected: 11/11 pass.

- [ ] **Step 3: Commit**

```bash
git add .github && git commit -m "ci: run adapter contract tests against postgres service"
```

---

## Self-Review (done at plan time)

1. **Spec coverage:** M0 exit criteria (dev window, three processes, lint/test, CI) → Tasks 1-4. M1 exit criteria (contract, RPC, PostgresAdapter, contract suite in Docker+CI) → Tasks 5-10. PRD adapter contract methods all present in Task 5 (listViews folded into `listTables().type` — documented in interface comment).
2. **Placeholder scan:** streaming/cancel stubs in Task 7 are explicit TDD intermediate states completed in Task 8; no dangling TBDs.
3. **Type consistency:** `PortLike`, `DbAdapter`, `ConnectionProfile`, `OpenQueryResult`, `Page` names identical across Tasks 5, 6, 7, 9. `dataType: string` in `FieldInfo` used consistently (dataTypeID stringified).
```

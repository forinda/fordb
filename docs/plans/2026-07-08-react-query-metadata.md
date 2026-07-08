# fordb React Query Metadata Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move introspection (schemas/tables/columns) and the profile list onto TanStack Query — deduped across the schema tree and SQL autocomplete, cached per connection, lazily loaded, and invalidatable — while query results stay on `QueryResultSource`.

**Architecture:** One `QueryClient` at the renderer root. A key factory prefixes every connection-scoped key with `['conn', connId]`. Introspection hooks + a `fetchColumns`/`invalidateIntrospection` pair back both the tree (lazy per-node) and a custom lazy CodeMirror completion source from the same cache. Profiles become a `useQuery`; the Zustand profiles slice is removed.

**Tech Stack:** `@tanstack/react-query`, React 19, react-arborist, CodeMirror 6 (`@codemirror/autocomplete`), Zustand (UI state only), vitest.

## Global Constraints

- pnpm; Node >= 22; TypeScript strict; no `any` except typed casts at the RPC/serialization boundary.
- Components use semantic theme tokens only (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `bg-destructive`, `ring`) — no raw color literals.
- New dep: `@tanstack/react-query` only.
- QueryClient defaults: `staleTime: 5 * 60_000`, `gcTime: 30 * 60_000`, `retry: 1`, `refetchOnWindowFocus: false`, `refetchOnReconnect: false`.
- Every connection-scoped query key begins `['conn', connId, …]`. Query RESULTS stay on `QueryResultSource` (unchanged).
- Existing 64 unit + 24 contract tests stay green. Every task ends with `pnpm typecheck && pnpm lint && pnpm test` passing, and `pnpm build` for renderer-touching tasks.
- `@shared/*` alias is available for shared imports.

## File Structure (end state)

```
src/renderer/src/
  query/client.ts          # NEW: QueryClient (desktop defaults)
  query/keys.ts            # NEW: qk key factory
  query/introspection.ts   # NEW: useSchemas/useTables/useColumns + fetchColumns + invalidateIntrospection
  query/profiles.ts        # NEW: useProfiles
  query/completion.ts      # MODIFY: custom lazy CompletionSource (was Map-cache loadSqlSchema)
  main.tsx                 # MODIFY: QueryClientProvider
  store.ts                 # MODIFY: remove profiles + loadProfiles slice
  store-query.ts           # MODIFY: DDL invalidation after non-SELECT executeQuery
  components/ConnectionList.tsx  # MODIFY: useProfiles + invalidate on save/delete
  components/SchemaTree.tsx      # MODIFY: lazy per-node from hooks
  components/SqlEditor.tsx       # MODIFY: pass connId+qc to the custom completion
  components/RefreshSchemaButton.tsx  # NEW
  App.tsx                  # MODIFY: Refresh-schema command; sidebar button
tests/
  unit/query-keys.test.ts  # NEW
  e2e/query.spec.ts        # MODIFY (optional, if lazy tree changes selectors)
```

---

### Task 1: QueryClient + key factory + provider

**Files:**

- Create: `src/renderer/src/query/client.ts`, `src/renderer/src/query/keys.ts`, `tests/unit/query-keys.test.ts`
- Modify: `src/renderer/src/main.tsx`

**Interfaces:**

- Produces: `queryClient` (a `QueryClient`); `qk` with `profiles(): ['profiles']`, `schemas(connId): ['conn', connId, 'schemas']`, `tables(connId, schema): ['conn', connId, 'tables', schema]`, `columns(connId, schema, table): ['conn', connId, 'columns', schema, table]`.

- [ ] **Step 1: Install**

```bash
pnpm add @tanstack/react-query
```

- [ ] **Step 2: Write failing key-factory test**

`tests/unit/query-keys.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { qk } from '../../src/renderer/src/query/keys'

describe('query key factory', () => {
  it('profiles key is stable and flat', () => {
    expect(qk.profiles()).toEqual(['profiles'])
  })
  it('connection-scoped keys are prefixed with conn+id', () => {
    expect(qk.schemas('c1')).toEqual(['conn', 'c1', 'schemas'])
    expect(qk.tables('c1', 'app')).toEqual(['conn', 'c1', 'tables', 'app'])
    expect(qk.columns('c1', 'app', 'users')).toEqual(['conn', 'c1', 'columns', 'app', 'users'])
  })
  it("['conn', id] is a prefix of every scoped key for that id only", () => {
    const keys = [qk.schemas('A'), qk.tables('A', 's'), qk.columns('A', 's', 't')]
    for (const k of keys) {
      expect(k.slice(0, 2)).toEqual(['conn', 'A'])
    }
    expect(qk.schemas('B').slice(0, 2)).not.toEqual(['conn', 'A'])
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test` — FAIL, module missing.

- [ ] **Step 4: Implement keys.ts**

`src/renderer/src/query/keys.ts`:

```ts
export const qk = {
  profiles: (): readonly ['profiles'] => ['profiles'] as const,
  schemas: (connId: string): readonly ['conn', string, 'schemas'] =>
    ['conn', connId, 'schemas'] as const,
  tables: (connId: string, schema: string): readonly ['conn', string, 'tables', string] =>
    ['conn', connId, 'tables', schema] as const,
  columns: (
    connId: string,
    schema: string,
    table: string
  ): readonly ['conn', string, 'columns', string, string] =>
    ['conn', connId, 'columns', schema, table] as const
}
```

- [ ] **Step 5: Implement client.ts**

`src/renderer/src/query/client.ts`:

```ts
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false
    }
  }
})
```

- [ ] **Step 6: Wrap App in the provider**

Modify `src/renderer/src/main.tsx` — wrap `<App />`:

```tsx
import './index.css'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { queryClient } from './query/client'

const initial = window.fordb.appearance.initialTheme
document.documentElement.classList.toggle('dark', initial === 'dark')
document.documentElement.classList.toggle('light', initial === 'light')

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
)
```

- [ ] **Step 7: Verify + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`

```bash
git add src/renderer/src/query/client.ts src/renderer/src/query/keys.ts src/renderer/src/main.tsx tests/unit/query-keys.test.ts package.json pnpm-lock.yaml
git commit -m "feat: QueryClient, key factory, and provider"
```

---

### Task 2: Introspection hooks + fetchColumns + invalidateIntrospection

**Files:**

- Create: `src/renderer/src/query/introspection.ts`, `tests/unit/introspection-invalidate.test.ts`

**Interfaces:**

- Consumes: `qk` (Task 1), `hostApi()`, `ColumnInfo`/`TableInfo` from `@shared/adapter/types`.
- Produces: `useSchemas(connId: string | null)`, `useTables(connId: string | null, schema: string | null)`, `useColumns(connId, schema, table)` (all return `UseQueryResult`); `fetchColumns(qc, connId, schema, table): Promise<ColumnInfo[]>`; `invalidateIntrospection(qc, connId): Promise<void>`.

- [ ] **Step 1: Write the failing invalidation-scoping test**

`tests/unit/introspection-invalidate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { qk } from '../../src/renderer/src/query/keys'
import { invalidateIntrospection } from '../../src/renderer/src/query/introspection'

describe('invalidateIntrospection scoping', () => {
  it('invalidates connA metadata but not connB', async () => {
    const qc = new QueryClient()
    // Seed cache entries for two connections.
    qc.setQueryData(qk.schemas('A'), ['app'])
    qc.setQueryData(qk.tables('A', 'app'), [])
    qc.setQueryData(qk.schemas('B'), ['app'])
    await invalidateIntrospection(qc, 'A')
    const stateA = qc.getQueryState(qk.schemas('A'))
    const stateB = qc.getQueryState(qk.schemas('B'))
    expect(stateA?.isInvalidated).toBe(true)
    expect(stateB?.isInvalidated).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test` — FAIL, module missing.

- [ ] **Step 3: Implement introspection.ts**

`src/renderer/src/query/introspection.ts`:

```ts
import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { ColumnInfo, TableInfo } from '@shared/adapter/types'
import { hostApi } from '../rpc'
import { qk } from './keys'

export function useSchemas(connId: string | null): UseQueryResult<string[]> {
  return useQuery({
    queryKey: connId ? qk.schemas(connId) : ['conn', 'none', 'schemas'],
    queryFn: async () => (await hostApi()).listSchemas(connId!),
    enabled: !!connId
  })
}

export function useTables(
  connId: string | null,
  schema: string | null
): UseQueryResult<TableInfo[]> {
  return useQuery({
    queryKey: connId && schema ? qk.tables(connId, schema) : ['conn', 'none', 'tables', ''],
    queryFn: async () => (await hostApi()).listTables(connId!, schema!),
    enabled: !!connId && !!schema
  })
}

export function useColumns(
  connId: string | null,
  schema: string | null,
  table: string | null
): UseQueryResult<ColumnInfo[]> {
  return useQuery({
    queryKey:
      connId && schema && table
        ? qk.columns(connId, schema, table)
        : ['conn', 'none', 'columns', '', ''],
    queryFn: async () => (await hostApi()).getColumns(connId!, schema!, table!),
    enabled: !!connId && !!schema && !!table
  })
}

/** Non-hook column fetch sharing the same cache entry as useColumns. */
export function fetchColumns(
  qc: QueryClient,
  connId: string,
  schema: string,
  table: string
): Promise<ColumnInfo[]> {
  return qc.fetchQuery({
    queryKey: qk.columns(connId, schema, table),
    queryFn: async () => (await hostApi()).getColumns(connId, schema, table)
  })
}

export function fetchSchemas(qc: QueryClient, connId: string): Promise<string[]> {
  return qc.fetchQuery({
    queryKey: qk.schemas(connId),
    queryFn: async () => (await hostApi()).listSchemas(connId)
  })
}

export function fetchTables(qc: QueryClient, connId: string, schema: string): Promise<TableInfo[]> {
  return qc.fetchQuery({
    queryKey: qk.tables(connId, schema),
    queryFn: async () => (await hostApi()).listTables(connId, schema)
  })
}

/** Invalidate all of a connection's introspection (schemas/tables/columns). */
export function invalidateIntrospection(qc: QueryClient, connId: string): Promise<void> {
  return qc.invalidateQueries({ queryKey: ['conn', connId] })
}
```

- [ ] **Step 4: Run to verify pass + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add src/renderer/src/query/introspection.ts tests/unit/introspection-invalidate.test.ts
git commit -m "feat: introspection hooks + fetchColumns + invalidateIntrospection"
```

---

### Task 3: Profiles useQuery; remove Zustand profiles slice

**Files:**

- Create: `src/renderer/src/query/profiles.ts`
- Modify: `src/renderer/src/store.ts`, `src/renderer/src/components/ConnectionList.tsx`, `src/renderer/src/components/ProfileForm.tsx`

**Interfaces:**

- Consumes: `qk` (Task 1), `window.fordb.profiles`.
- Produces: `useProfiles(): UseQueryResult<ConnectionProfile[]>`; `useInvalidateProfiles(): () => void`.

- [ ] **Step 1: profiles.ts**

`src/renderer/src/query/profiles.ts`:

```ts
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { ConnectionProfile } from '@shared/adapter/types'
import { qk } from './keys'

export function useProfiles(): UseQueryResult<ConnectionProfile[]> {
  return useQuery({ queryKey: qk.profiles(), queryFn: () => window.fordb.profiles.list() })
}

export function useInvalidateProfiles(): () => void {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: qk.profiles() })
  }
}
```

- [ ] **Step 2: Remove the profiles slice from store.ts**

Read `src/renderer/src/store.ts` first. Remove `profiles` and `loadProfiles` from the `ConnState` interface and the store; keep `activeConnectionId`, `activeProfileId`, `setActive`, `clearActive`. Full revised `store.ts`:

```ts
import { create } from 'zustand'

interface ConnState {
  activeConnectionId: string | null
  activeProfileId: string | null
  setActive: (connectionId: string, profileId: string) => void
  clearActive: () => void
}

export const useConnStore = create<ConnState>((set) => ({
  activeConnectionId: null,
  activeProfileId: null,
  setActive: (connectionId, profileId) =>
    set({ activeConnectionId: connectionId, activeProfileId: profileId }),
  clearActive: () => set({ activeConnectionId: null, activeProfileId: null })
}))
```

- [ ] **Step 3: ConnectionList uses useProfiles**

Read `src/renderer/src/components/ConnectionList.tsx`. Replace the `useConnStore` profiles read + `useEffect(load)` with `const { data: profiles = [] } = useProfiles()`. Replace the delete handler's `useConnStore.getState().loadProfiles()` with the invalidate hook. Concrete changes:

- Import `useProfiles`, `useInvalidateProfiles` from `../query/profiles`.
- Remove `const profiles = useConnStore(...)`, `const load = useConnStore(...)`, and the `useEffect`.
- Add `const { data: profiles = [] } = useProfiles()` and `const invalidateProfiles = useInvalidateProfiles()`.
- In the delete button: `void window.fordb.profiles.delete(p.id).then(() => invalidateProfiles())`.

- [ ] **Step 4: ProfileForm invalidates instead of loadProfiles**

Read `src/renderer/src/components/ProfileForm.tsx`. It calls `useConnStore.getState().loadProfiles()` in `save()`/`test()`. Replace those with `useInvalidateProfiles()`:

- Import `useInvalidateProfiles`.
- `const invalidateProfiles = useInvalidateProfiles()` in the component.
- In `save()`: after `window.fordb.profiles.save(...)`, call `invalidateProfiles()` (remove the `useConnStore.getState().loadProfiles()` line). In `test()`, the save-then-test flow: keep the save, no list reload needed there (or invalidate too — harmless).

- [ ] **Step 5: Verify (grep for stragglers) + commit**

Run: `grep -rn "loadProfiles\|s.profiles\|\.profiles\b" src/renderer/src | grep -v "query/profiles\|window.fordb.profiles\|fordb: {"` — should be empty (no remaining store-profiles usage).
Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

```bash
git add src/renderer/src/query/profiles.ts src/renderer/src/store.ts src/renderer/src/components/ConnectionList.tsx src/renderer/src/components/ProfileForm.tsx
git commit -m "feat: profiles via useQuery, remove Zustand profiles slice"
```

---

### Task 4: Lazy per-node SchemaTree

**Files:**

- Modify: `src/renderer/src/components/SchemaTree.tsx`

**Interfaces:**

- Consumes: `useSchemas`/`useTables`/`useColumns` (Task 2), `useConnStore` (activeConnectionId).
- Produces: a tree that loads a schema's tables on expand and a table's columns on expand.

- [ ] **Step 1: Rewrite SchemaTree with lazy children**

Read the current `src/renderer/src/components/SchemaTree.tsx` first. Rewrite to derive react-arborist `data` from per-node hooks, tracking expanded keys and mounting child-fetching subcomponents. Because react-hooks can't be called in a loop over dynamic nodes at the top level, use a small child component per schema that owns its `useTables`, and per table `useColumns`. Full file:

```tsx
import { useMemo } from 'react'
import { Tree } from 'react-arborist'
import { useConnStore } from '../store'
import { useSchemas, useTables, useColumns } from '../query/introspection'

interface Node {
  id: string
  name: string
  kind: 'schema' | 'table' | 'view' | 'column' | 'loading'
  connId: string
  schema?: string
  table?: string
  children?: Node[]
}

function SchemaChildren(props: { connId: string; schema: string }): Node[] {
  const { data: tables, isLoading } = useTables(props.connId, props.schema)
  if (isLoading)
    return [{ id: `l:${props.schema}`, name: 'loading…', kind: 'loading', connId: props.connId }]
  return (tables ?? []).map((t) => ({
    id: `t:${props.schema}.${t.name}`,
    name: t.name,
    kind: t.type,
    connId: props.connId,
    schema: props.schema,
    table: t.name,
    children: []
  }))
}

// react-arborist calls this render for each visible row; we can't call hooks
// here. Instead we assemble the whole visible tree from cache-backed hooks in
// the parent by rendering one hidden hook-holder per expanded node. To keep it
// simple and correct, this M-ReactQuery version loads schemas eagerly at the
// schema level (cheap: names only) and each schema's tables lazily on expand,
// and each table's columns lazily on expand, using the openByDefault=false
// tree plus onToggle-driven state.

export function SchemaTree(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  const { data: schemas, isLoading, error } = useSchemas(connId)

  const data: Node[] = useMemo(
    () =>
      (schemas ?? []).map((s) => ({
        id: `s:${s}`,
        name: s,
        kind: 'schema' as const,
        connId: connId ?? '',
        schema: s,
        children: [] // filled lazily via <SchemaNode/> below when expanded
      })),
    [schemas, connId]
  )

  if (error)
    return (
      <div className="p-4 text-destructive">
        Schema load failed: {error instanceof Error ? error.message : String(error)}
      </div>
    )
  if (isLoading) return <div className="p-4 text-muted-foreground">Loading schemas…</div>

  return (
    <div className="p-2">
      <Tree data={data} openByDefault={false} width={240} height={600} indent={16} rowHeight={24}>
        {({ node, style, dragHandle }) => (
          <SchemaRow node={node.data} style={style} dragHandle={dragHandle} isOpen={node.isOpen} />
        )}
      </Tree>
    </div>
  )
}

function SchemaRow(props: {
  node: Node
  style: React.CSSProperties
  dragHandle?: (el: HTMLDivElement | null) => void
  isOpen: boolean
}): React.JSX.Element {
  const glyph =
    props.node.kind === 'schema'
      ? '▸'
      : props.node.kind === 'view'
        ? '◇'
        : props.node.kind === 'loading'
          ? '…'
          : '▪'
  // Warm the cache for this schema's tables when its row is open (react-arborist
  // renders children lazily; opening a schema mounts this row with isOpen).
  return (
    <div style={props.style} ref={props.dragHandle} className="flex items-center gap-1 text-sm">
      <span className="text-muted-foreground">{glyph}</span>
      <span className="text-foreground">{props.node.name}</span>
    </div>
  )
}
```

Note: react-arborist's controlled-lazy-children pattern is genuinely fiddly. This task's ACCEPTANCE is: (a) schemas load via `useSchemas` (React Query, cached); (b) a schema's tables are fetched **on expand** via `useTables` and shown as children; (c) no eager column load on connect. The exact react-arborist wiring (controlled `data` updated on toggle, or `children` async loader) may differ from the sketch above — implement whichever the installed react-arborist version supports cleanly, keeping the acceptance behavior and semantic tokens. If controlled lazy children prove too fiddly in the time box, an acceptable fallback is: schemas via `useSchemas`, and each schema node renders a `SchemaChildren` sub-hook that lazily calls `useTables` when its subtree is opened — but do NOT revert to the M3 eager "load all tables+columns on connect." Report exactly what wiring you used.

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Then headless dev smoke; report whether the tree renders schemas.

```bash
git add src/renderer/src/components/SchemaTree.tsx
git commit -m "feat: lazy per-node schema tree over React Query"
```

---

### Task 5: Custom lazy CodeMirror completion source

**Files:**

- Modify: `src/renderer/src/query/completion.ts`, `src/renderer/src/components/SqlEditor.tsx`

**Interfaces:**

- Consumes: `fetchSchemas`/`fetchTables`/`fetchColumns` (Task 2), `queryClient`.
- Produces: `schemaCompletionSource(connId: string): CompletionSource` (async), replacing `loadSqlSchema`.

- [ ] **Step 1: Rewrite completion.ts as a custom source**

`src/renderer/src/query/completion.ts`:

```ts
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete'
import { queryClient } from './client'
import { fetchSchemas, fetchTables, fetchColumns } from './introspection'

// Completes: bare identifiers → schema/table names; `table.` → that table's
// columns (looked up across schemas). Uses the shared React Query cache, so it
// dedups with the schema tree. Alias resolution is out of scope (deferred).
export function schemaCompletionSource(connId: string) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    // `word.` — complete columns of `word` (a table name in any schema).
    const dotted = ctx.matchBefore(/([A-Za-z_][\w]*)\.\w*/)
    if (dotted) {
      const table = dotted.text.split('.')[0]!
      const schemas = await fetchSchemas(queryClient, connId)
      for (const schema of schemas) {
        const tables = await fetchTables(queryClient, connId, schema)
        if (tables.some((t) => t.name === table)) {
          const cols = await fetchColumns(queryClient, connId, schema, table)
          const options: Completion[] = cols.map((c) => ({ label: c.name, type: 'property' }))
          return { from: dotted.from + table.length + 1, options }
        }
      }
      return null
    }
    // Bare word → schema + table names.
    const word = ctx.matchBefore(/[\w]+/)
    if (!word || (word.from === word.to && !ctx.explicit)) return null
    const schemas = await fetchSchemas(queryClient, connId)
    const options: Completion[] = schemas.map((s) => ({ label: s, type: 'namespace' }))
    for (const schema of schemas) {
      const tables = await fetchTables(queryClient, connId, schema)
      for (const t of tables) options.push({ label: t.name, type: 'class' })
    }
    return { from: word.from, options }
  }
}
```

Note: fetching every schema's tables for the bare-word case is acceptable (cached after first use). If it proves heavy on huge schemas, gate the table listing to the current statement's `FROM` tables in a later pass — out of scope here.

- [ ] **Step 2: Wire into SqlEditor**

Read `src/renderer/src/components/SqlEditor.tsx`. Replace the `loadSqlSchema` + lang-sql `schema` option with the custom source. Change the extensions: keep `sql({ dialect: PostgreSQL, upperCaseKeywords: true })` (for keyword highlighting/completion) and set `autocompletion({ override: [schemaCompletionSource(props.connectionId)] })` when `connectionId` is present. Concretely:

- Import `schemaCompletionSource` from `../query/completion` (remove `loadSqlSchema`, remove the `schema` var + `.then`).
- In the extensions array: `sql({ dialect: PostgreSQL, upperCaseKeywords: true })`, and
  `autocompletion(props.connectionId ? { override: [schemaCompletionSource(props.connectionId)] } : {})`.
- The effect still keys on `[props.connectionId]` so the source rebinds per connection.

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

```bash
git add src/renderer/src/query/completion.ts src/renderer/src/components/SqlEditor.tsx
git commit -m "feat: lazy shared-cache CodeMirror completion source"
```

---

### Task 6: Refresh-schema button + command + DDL invalidation

**Files:**

- Create: `src/renderer/src/components/RefreshSchemaButton.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/store-query.ts`

**Interfaces:**

- Consumes: `invalidateIntrospection` (Task 2), `queryClient`, `useConnStore`.
- Produces: `<RefreshSchemaButton />`; a "Refresh schema" palette command; DDL-invalidation in `run()`.

- [ ] **Step 1: RefreshSchemaButton**

`src/renderer/src/components/RefreshSchemaButton.tsx`:

```tsx
import { useConnStore } from '../store'
import { queryClient } from '../query/client'
import { invalidateIntrospection } from '../query/introspection'
import { Button } from './ui/button'

export function RefreshSchemaButton(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={!connId}
      onClick={() => {
        if (connId) void invalidateIntrospection(queryClient, connId)
      }}
    >
      Refresh schema
    </Button>
  )
}
```

- [ ] **Step 2: DDL invalidation in store-query run()**

Read `src/renderer/src/store-query.ts`. In `run()`'s non-SELECT (`executeQuery`) success branch, after setting status done, invalidate the connection's introspection (schema may have changed). Add the imports `import { queryClient } from './query/client'` and `import { invalidateIntrospection } from './query/introspection'`, then in the else branch after the `set(...)`:

```ts
void invalidateIntrospection(queryClient, connId)
```

- [ ] **Step 3: Wire button + command in App.tsx**

Read `src/renderer/src/App.tsx`. Add:

- Import `RefreshSchemaButton` and (for the command) `queryClient` + `invalidateIntrospection` + read `activeConnectionId` (already read as `activeConnectionId`).
- Render `<RefreshSchemaButton />` in the sidebar (e.g. next to the schema tree area, only meaningful when connected).
- Add a command: `{ id: 'refresh-schema', label: 'Refresh schema', run: () => { if (activeConnectionId) void invalidateIntrospection(queryClient, activeConnectionId) } }`.

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

```bash
git add src/renderer/src/components/RefreshSchemaButton.tsx src/renderer/src/App.tsx src/renderer/src/store-query.ts
git commit -m "feat: refresh-schema button/command + DDL invalidation"
```

---

### Task 7: e2e sanity + full-suite green

**Files:**

- Modify (if needed): `tests/e2e/query.spec.ts`

**Interfaces:**

- Consumes: the running app.

- [ ] **Step 1: Confirm the query e2e still matches**

Read `tests/e2e/query.spec.ts`. The refactor keeps the connect→run→rows flow; only the tree/autocomplete internals changed. If the e2e asserts on tree behavior that changed (lazy load), update the selector; otherwise leave it. If nothing needs changing, this task is a verification-only pass.

- [ ] **Step 2: Full verify**

Run: `pnpm typecheck && pnpm lint && pnpm test` (66 unit: +query-keys, +introspection-invalidate), `pnpm build`, and `pnpm db:up && pnpm test:contract` (24 contract unchanged), `pnpm db:down`.
Expected: all green. Headless dev smoke: app boots, tree shows schemas.

- [ ] **Step 3: Commit (if any e2e change)**

```bash
git add tests/e2e/query.spec.ts
git commit -m "test: adjust query e2e for React Query metadata layer"
```

---

## Self-Review (done at plan time)

1. **Spec coverage:** Foundation (spec §1) → Task 1. Introspection hooks + fetchColumns + invalidate (§2) → Task 2. Lazy tree (§3) → Task 4. Lazy shared-cache completion (§4) → Task 5. Profiles useQuery + remove slice (§5) → Task 3. Refresh + DDL invalidation (§6) → Task 6. Testing (§7): key + invalidate unit tests (1,2), e2e (7). Success criteria: shared cache (2,4,5), lazy tree (4), refresh+DDL (6), profiles+slice-removed (3), no results regression (results untouched).
2. **Placeholder scan:** Task 4 (SchemaTree) and Task 5 (completion) carry explicit "implement whichever the installed react-arborist/CodeMirror version supports, keeping the acceptance behavior" notes — deliberate because the exact react-arborist controlled-lazy API and CM matchBefore ranges can vary; the ACCEPTANCE (lazy tables on expand; table.col completion from shared cache) and the hook/`fetchColumns` contracts are fully specified. No TBDs elsewhere; all other code inlined.
3. **Type consistency:** `qk.{profiles,schemas,tables,columns}`, `useSchemas/useTables/useColumns`, `fetchColumns/fetchSchemas/fetchTables`, `invalidateIntrospection(qc, connId)`, `useProfiles/useInvalidateProfiles`, `schemaCompletionSource(connId)` — consistent across Tasks 1–6. `queryClient` singleton imported where needed.

**Known deliberate deferrals:** alias-aware completion (`u.col` from `FROM users u`) is out of scope (only `table.col`); the react-arborist lazy wiring is acceptance-defined, not byte-pinned; the DDL invalidation is best-effort (any successful non-SELECT invalidates, even if it wasn't DDL — cheap and safe).

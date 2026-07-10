# fordb MA7 — Server Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cancel/terminate backends from the sessions dashboard, view roles & grants, and browse server settings — Postgres-only, capability-gated.

**Architecture:** New engine-gated `ServerAdmin` capability (PG only) with `PgServerAdmin`. HostApi routes it. The dashboard's sessions table gains Cancel/Terminate; new Roles and Settings panels + sub-tabs.

**Tech Stack:** TypeScript strict, `pg`, React 19, Zustand, TanStack Query, vitest.

## Global Constraints

- pnpm; Node >= 22; TypeScript strict; no `any` except typed RPC/DB-boundary casts.
- pids BOUND ($1) in cancel/terminate; role name bound in roleGrants. No interpolation.
- Capability-gated (`adapter.serverAdmin`): the admin UI only renders when supported (PG). Host throws defensively if bypassed.
- Destructive actions (terminate a backend) require a confirm.
- `@shared/*` alias. Renderer-importing tests → `tsconfig.web`; pure/db-host → `tsconfig.node`.
- Each task ends `pnpm typecheck && pnpm lint && pnpm test` (+ `pnpm build` for renderer). Contract tasks run `pnpm db:up && pnpm test:contract && pnpm db:down`. One PR per task against `main`.
- No e2e (PG admin surface needs the OS keychain, unavailable headless — documented in the spec).

## File Structure (end state)

```
src/shared/adapter/admin-types.ts              # NEW: RoleInfo, GrantInfo, SettingRow, ServerAdmin
src/shared/adapter/db-adapter.ts               # MODIFY: readonly serverAdmin?
src/db-host/postgres/admin-sql.ts              # NEW: role/grant/settings queries
src/db-host/postgres/postgres-admin.ts         # NEW: PgServerAdmin
src/db-host/postgres/postgres-adapter.ts       # MODIFY: serverAdmin wiring
src/shared/host/host-api.ts + src/db-host/host-api-impl.ts   # MODIFY: admin routing
src/renderer/src/query/{keys,admin}.ts         # NEW admin hooks + keys
src/renderer/src/components/dashboard/{SessionsTable,RolesPanel,SettingsPanel}.tsx
src/renderer/src/components/ServerDashboard.tsx # MODIFY: sub-tabs
tests/contract/adapter-contract.ts · host-api.contract.test.ts   # MODIFY
```

---

### Task 1: ServerAdmin types + PgServerAdmin + contract

**Files:** Create `src/shared/adapter/admin-types.ts`, `src/db-host/postgres/admin-sql.ts`, `src/db-host/postgres/postgres-admin.ts`; modify `src/shared/adapter/db-adapter.ts`, `src/db-host/postgres/postgres-adapter.ts`, `tests/contract/adapter-contract.ts`.

- [ ] **Step 1: Types**

`admin-types.ts`:

```ts
export interface RoleInfo {
  name: string
  canLogin: boolean
  superuser: boolean
  createRole: boolean
  createDb: boolean
  replication: boolean
  memberOf: string[]
}
export interface GrantInfo {
  schema: string
  table: string
  privilege: string
  grantor: string | null
}
export interface SettingRow {
  name: string
  value: string
  unit: string | null
  category: string | null
  description: string | null
}
export interface ServerAdmin {
  cancelBackend(pid: number): Promise<boolean>
  terminateBackend(pid: number): Promise<boolean>
  listRoles(): Promise<RoleInfo[]>
  roleGrants(role: string): Promise<GrantInfo[]>
  serverSettings(): Promise<SettingRow[]>
}
```

`db-adapter.ts` — add `import type { ServerAdmin } from './admin-types'` and after `objects?`:

```ts
  /** Optional server-administration capability (Postgres). */
  readonly serverAdmin?: ServerAdmin
```

- [ ] **Step 2: SQL**

`admin-sql.ts`:

```ts
export const CANCEL = `SELECT pg_cancel_backend($1) AS ok`
export const TERMINATE = `SELECT pg_terminate_backend($1) AS ok`
export const LIST_ROLES = `
  SELECT r.rolname AS name, r.rolcanlogin AS "canLogin", r.rolsuper AS superuser,
         r.rolcreaterole AS "createRole", r.rolcreatedb AS "createDb",
         r.rolreplication AS replication,
         COALESCE(ARRAY(
           SELECT g.rolname FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
           WHERE m.member = r.oid ORDER BY g.rolname
         ), '{}') AS "memberOf"
  FROM pg_roles r WHERE r.rolname NOT LIKE 'pg\\_%' ORDER BY r.rolname`
export const ROLE_GRANTS = `
  SELECT table_schema AS schema, table_name AS table, privilege_type AS privilege, grantor
  FROM information_schema.role_table_grants WHERE grantee = $1
  ORDER BY table_schema, table_name, privilege_type`
export const SETTINGS = `
  SELECT name, setting AS value, unit, category, short_desc AS description
  FROM pg_settings ORDER BY category, name`
```

- [ ] **Step 3: PgServerAdmin**

`postgres-admin.ts`:

```ts
import type pg from 'pg'
import type { GrantInfo, RoleInfo, ServerAdmin, SettingRow } from '@shared/adapter/admin-types'
import * as SQL from './admin-sql'

export class PgServerAdmin implements ServerAdmin {
  constructor(private readonly conn: () => pg.Client) {}
  private async bool(sql: string, pid: number): Promise<boolean> {
    const r = await this.conn().query(sql, [pid])
    return Boolean((r.rows[0] as { ok?: boolean } | undefined)?.ok)
  }
  cancelBackend(pid: number): Promise<boolean> {
    return this.bool(SQL.CANCEL, pid)
  }
  terminateBackend(pid: number): Promise<boolean> {
    return this.bool(SQL.TERMINATE, pid)
  }
  async listRoles(): Promise<RoleInfo[]> {
    return (await this.conn().query(SQL.LIST_ROLES)).rows as RoleInfo[]
  }
  async roleGrants(role: string): Promise<GrantInfo[]> {
    return (await this.conn().query(SQL.ROLE_GRANTS, [role])).rows as GrantInfo[]
  }
  async serverSettings(): Promise<SettingRow[]> {
    return (await this.conn().query(SQL.SETTINGS)).rows as SettingRow[]
  }
}
```

Wire in `postgres-adapter.ts`: import `PgServerAdmin` + `ServerAdmin`, add next to `serverStats`:

```ts
  readonly serverAdmin: ServerAdmin = new PgServerAdmin(() => this.conn)
```

- [ ] **Step 4: Contract**

In `tests/contract/adapter-contract.ts` add (Postgres-gated):

```ts
it('server admin: roles, settings, grants, cancel/terminate a bogus pid', async () => {
  if (!adapter.serverAdmin) return
  const roles = await adapter.serverAdmin.listRoles()
  expect(roles.some((r) => r.name === 'fordb')).toBe(true)
  const settings = await adapter.serverAdmin.serverSettings()
  expect(settings.some((s) => s.name === 'max_connections')).toBe(true)
  expect(Array.isArray(await adapter.serverAdmin.roleGrants('fordb'))).toBe(true)
  // No backend with pid 0 → false, not a throw.
  expect(await adapter.serverAdmin.cancelBackend(0)).toBe(false)
  expect(await adapter.serverAdmin.terminateBackend(0)).toBe(false)
})
```

- [ ] **Step 5: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm db:up && pnpm test:contract && pnpm db:down`.

```bash
git add src/shared/adapter/admin-types.ts src/shared/adapter/db-adapter.ts src/db-host/postgres/admin-sql.ts src/db-host/postgres/postgres-admin.ts src/db-host/postgres/postgres-adapter.ts tests/contract/adapter-contract.ts
git commit -m "feat: ServerAdmin capability + PgServerAdmin (cancel/terminate, roles, settings) + contract"
```

---

### Task 2: HostApi admin routing + contract

**Files:** Modify `src/shared/host/host-api.ts`, `src/db-host/host-api-impl.ts`, `tests/contract/host-api.contract.test.ts`.

- [ ] **Step 1: Interface + routing**

`host-api.ts` — `import type { RoleInfo, GrantInfo, SettingRow } from '../adapter/admin-types'`, add:

```ts
  serverAdminSupported(id: ConnectionId): Promise<boolean>
  cancelBackend(id: ConnectionId, pid: number): Promise<boolean>
  terminateBackend(id: ConnectionId, pid: number): Promise<boolean>
  listRoles(id: ConnectionId): Promise<RoleInfo[]>
  roleGrants(id: ConnectionId, role: string): Promise<GrantInfo[]>
  serverSettings(id: ConnectionId): Promise<SettingRow[]>
```

`host-api-impl.ts` — import `ServerAdmin` + the types, add:

```ts
  private admin(id: ConnectionId): ServerAdmin {
    const a = this.registry.get(id).serverAdmin
    if (!a) throw new Error('Server administration is not supported by this engine')
    return a
  }
  async serverAdminSupported(id: ConnectionId): Promise<boolean> {
    return this.registry.get(id).serverAdmin != null
  }
  cancelBackend(id: ConnectionId, pid: number): Promise<boolean> {
    return this.admin(id).cancelBackend(pid)
  }
  terminateBackend(id: ConnectionId, pid: number): Promise<boolean> {
    return this.admin(id).terminateBackend(pid)
  }
  listRoles(id: ConnectionId): Promise<RoleInfo[]> {
    return this.admin(id).listRoles()
  }
  roleGrants(id: ConnectionId, role: string): Promise<GrantInfo[]> {
    return this.admin(id).roleGrants(role)
  }
  serverSettings(id: ConnectionId): Promise<SettingRow[]> {
    return this.admin(id).serverSettings()
  }
```

- [ ] **Step 2: Contract**

`host-api.contract.test.ts`:

```ts
it('exposes server admin over the HostApi', async () => {
  const id = await client.openConnection(profile)
  expect(await client.serverAdminSupported(id)).toBe(true)
  expect((await client.listRoles(id)).some((r) => r.name === 'fordb')).toBe(true)
  expect((await client.serverSettings(id)).some((s) => s.name === 'max_connections')).toBe(true)
  expect(await client.cancelBackend(id, 0)).toBe(false)
  await client.closeConnection(id)
})
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm db:up && pnpm test:contract && pnpm db:down`.

```bash
git add src/shared/host/host-api.ts src/db-host/host-api-impl.ts tests/contract/host-api.contract.test.ts
git commit -m "feat: HostApi server-admin routing + contract"
```

---

### Task 3: Sessions Cancel/Terminate actions

**Files:** Create `src/renderer/src/query/admin.ts`; modify `src/renderer/src/query/keys.ts`, `src/renderer/src/components/dashboard/SessionsTable.tsx`, `src/renderer/src/components/ServerDashboard.tsx`.

**Interfaces:** `useServerAdminSupported(connId)`; `cancelBackend`/`terminateBackend` via `window.fordb` (RPC).

**Acceptance:**

- `admin.ts`: `useServerAdminSupported(connId)` (one-shot, mirrors `useServerStatsSupported`).
- `SessionsTable` gains an optional `admin?: { onCancel(pid), onTerminate(pid) }` prop; when present, a trailing actions column renders **Cancel** and **Terminate** buttons per row. Terminate confirms (`window.confirm`). Not shown for the current connection's own pid if easily available (optional).
- `ServerDashboard`: when `serverAdminSupported`, pass an `admin` handler to `SessionsTable` that calls `hostApi().cancelBackend/terminateBackend(connId, pid)` then invalidates/refetches the sessions query. Errors → the existing dashboard error surface.

- [ ] **Step 1: Implement**

Build per acceptance. Reuse the sessions query invalidation (refetch after an action).

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

```bash
git add src/renderer/src/query/admin.ts src/renderer/src/query/keys.ts src/renderer/src/components/dashboard/SessionsTable.tsx src/renderer/src/components/ServerDashboard.tsx
git commit -m "feat: cancel/terminate a backend from the sessions dashboard"
```

---

### Task 4: Roles & grants + Settings panels

**Files:** Create `src/renderer/src/components/dashboard/RolesPanel.tsx`, `src/renderer/src/components/dashboard/SettingsPanel.tsx`; modify `src/renderer/src/query/admin.ts`, `src/renderer/src/components/ServerDashboard.tsx`.

**Interfaces:** `useRoles(connId)`, `useRoleGrants(connId, role)`, `useServerSettings(connId)`.

**Acceptance:**

- `admin.ts` adds one-shot hooks: `useRoles`, `useServerSettings`, and `useRoleGrants(connId, role|null)` (enabled when a role is selected).
- **RolesPanel**: a list of roles (name + attribute badges: login/super/createrole/createdb/replication + memberOf); selecting a role shows its grants (schema.table — privilege) from `useRoleGrants`.
- **SettingsPanel**: a filterable table of `useServerSettings` (name/value/unit/category); a text filter over name+category.
- `ServerDashboard`: add **Sessions / Roles / Settings** sub-tabs (a small local tab state); Roles + Settings render only when `serverAdminSupported`. Sessions stays the default.

- [ ] **Step 1: Implement**

Build per acceptance with existing table/panel styling.

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Report the dashboard layout.

```bash
git add src/renderer/src/components/dashboard/RolesPanel.tsx src/renderer/src/components/dashboard/SettingsPanel.tsx src/renderer/src/query/admin.ts src/renderer/src/components/ServerDashboard.tsx
git commit -m "feat: roles & grants + server settings dashboard panels"
```

---

## Self-Review (done at plan time)

1. **Spec coverage:** ServerAdmin capability + PgServerAdmin (spec §capability) → Task 1; HostApi (§HostApi) → Task 2; cancel/terminate (§Renderer sessions) → Task 3; roles/grants + settings (§Renderer) → Task 4; contract (§Testing) → Tasks 1–2; e2e deliberately omitted (§Testing).
2. **Placeholder scan:** Full code in Tasks 1–2. Tasks 3–4 acceptance-defined (dashboard panels follow existing SessionsTable/stats patterns) with every consumed contract (`ServerAdmin`, the HostApi admin methods, the stats sub-tab pattern) fully specified.
3. **Type consistency:** `RoleInfo`/`GrantInfo`/`SettingRow`/`ServerAdmin` (1) used 2–4. HostApi admin methods (2) consumed by the admin hooks (3/4). pids bound; role name bound.

**Known deliberate deferrals:** role/grant editing (CREATE/ALTER/DROP ROLE, GRANT/REVOKE), ALTER SYSTEM settings changes, SQLite (no server admin), PG e2e (headless keychain limitation).

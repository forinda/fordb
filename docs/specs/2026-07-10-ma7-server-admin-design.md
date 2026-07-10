# MA7 — Server Administration (Design)

**Status:** approved scope (all three: backends + roles/grants + settings), ready for plan
**Date:** 2026-07-10
**Milestone:** MA7 (Postgres-first)

## Goal

Turn the read-only server dashboard into actual administration: **cancel / terminate** a backend from the sessions table (behind confirm), a **Roles & grants** view (roles, attributes, memberships, table privileges), and a read-only **server settings** view (`pg_settings`). Postgres-only — SQLite has no server, backends, or roles, so the capability is absent and the UI hides it.

## Scope

### In (MA7)

- **Cancel / terminate a backend** — per-session actions calling `pg_cancel_backend(pid)` / `pg_terminate_backend(pid)`, each behind a confirm. The session list refreshes after.
- **Roles & grants** — list roles with their attributes (login/superuser/createrole/createdb/replication) + memberships; per-role table privileges.
- **Server settings** — a filterable read-only table of `pg_settings` (name, value, unit, category, description).

### Out (later)

- Creating/altering/dropping roles; GRANT/REVOKE editing (read-only in MA7).
- Changing settings (ALTER SYSTEM); per-database/role settings.
- SQLite (no server-admin surface).

## Architecture

New optional capability, engine-gated exactly like `serverStats` (Postgres implements it; SQLite omits it → the whole admin surface disappears).

### `ServerAdmin` capability (`src/shared/adapter/admin-types.ts`)

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
  privilege: string // SELECT / INSERT / …
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
  cancelBackend(pid: number): Promise<boolean> // pg_cancel_backend
  terminateBackend(pid: number): Promise<boolean> // pg_terminate_backend
  listRoles(): Promise<RoleInfo[]>
  roleGrants(role: string): Promise<GrantInfo[]>
  serverSettings(): Promise<SettingRow[]>
}
```

`DbAdapter` gains `readonly serverAdmin?: ServerAdmin`.

- **`PgServerAdmin`** (`src/db-host/postgres/postgres-admin.ts`), constructed with the adapter's `() => pg.Client` connection accessor:
  - cancel/terminate: `SELECT pg_cancel_backend($1)` / `SELECT pg_terminate_backend($1)` — pid **bound**, returns the boolean.
  - listRoles: `pg_roles` (rolname/rolcanlogin/rolsuper/rolcreaterole/rolcreatedb/rolreplication), plus memberships via `pg_auth_members`. Exclude internal `pg_*` roles.
  - roleGrants: `information_schema.role_table_grants WHERE grantee = $1` → schema/table/privilege/grantor.
  - serverSettings: `SELECT name, setting, unit, category, short_desc FROM pg_settings ORDER BY category, name`.

No writes touch secrets; the admin actions run on the already-authenticated connection.

### HostApi

```ts
serverAdminSupported(id): Promise<boolean>
cancelBackend(id, pid): Promise<boolean>
terminateBackend(id, pid): Promise<boolean>
listRoles(id): Promise<RoleInfo[]>
roleGrants(id, role): Promise<GrantInfo[]>
serverSettings(id): Promise<SettingRow[]>
```

Routed like the other capabilities (throw if `serverAdmin` absent).

### Renderer

- **Sessions table** (`dashboard/SessionsTable.tsx`): a trailing actions column with **Cancel** and **Terminate** buttons per row; each does `window.confirm` then the RPC then refreshes the sessions query. Gated on `serverAdminSupported`.
- **Roles & grants** (`dashboard/RolesPanel.tsx`): a roles list (name + attribute badges + memberOf); selecting a role loads and shows its table grants. One-shot fetch (not polled).
- **Settings** (`dashboard/SettingsPanel.tsx`): a filterable table of `pg_settings`.
- `ServerDashboard` gains **Sessions / Roles / Settings** sub-tabs (or stacked sections); Roles/Settings only render when `serverAdminSupported`.

## Data flow (terminate a stuck backend)

1. Dashboard → Sessions → a row shows pid 12345 idle-in-transaction → **Terminate** → confirm → `terminateBackend(id, 12345)` → sessions refetch → row gone.

## Error handling

- cancel/terminate on a nonexistent pid → PG returns `false` (no throw); the UI shows a brief "no such backend / already gone" note and refreshes.
- Insufficient privilege (non-superuser terminating another user's backend) → the engine error surfaces in the dashboard's error banner.
- An engine without `serverAdmin` → no admin UI rendered (capability-gated).

## Security

- Admin actions run on the user's own authenticated connection under their DB privileges — the DB enforces who may cancel/terminate/see roles. No secrets involved. pids are bound parameters.

## Testing

- **Contract** (capability-gated, Postgres only): `serverAdmin` present on PG, absent on SQLite; `listRoles()` includes the connected role (`fordb`); `serverSettings()` is non-empty and includes a known key (e.g. `max_connections`); `roleGrants('fordb')` runs (array); `cancelBackend(0)`/`terminateBackend(0)` return `false` without throwing (no backend 0).
- **Unit**: none new (no pure logic beyond SQL).
- **e2e**: none. The admin surface is Postgres-only, and the Postgres e2e path needs the OS keychain (`safeStorage`), which isn't available headless — the same limitation the existing `query.spec` hits. Coverage is the contract suite + the shared RPC contract; documented here as a deliberate gap.

## Exit criteria

Cancel and terminate a session from the dashboard; view roles and their grants; browse server settings — all Postgres, capability-gated.

## Task decomposition (for the plan)

1. `ServerAdmin` types + `DbAdapter.serverAdmin?` + `PgServerAdmin` + contract.
2. HostApi routing (serverAdminSupported/cancel/terminate/listRoles/roleGrants/serverSettings) + host-api contract.
3. Renderer: sessions Cancel/Terminate actions (confirm + refetch), gated on serverAdminSupported.
4. Renderer: Roles & grants panel + Settings panel + dashboard sub-tabs.

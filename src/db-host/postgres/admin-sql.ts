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

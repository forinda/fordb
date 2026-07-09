export const SNAPSHOT = `
SELECT
  d.xact_commit, d.xact_rollback, d.blks_read, d.blks_hit,
  d.tup_returned, d.tup_fetched, d.tup_inserted, d.tup_updated, d.tup_deleted,
  pg_database_size(current_database()) AS db_size,
  (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
  (SELECT count(*) FROM pg_stat_activity) AS backends,
  (pg_has_role(current_user, 'pg_monitor', 'MEMBER')
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper)) AS full_visibility
FROM pg_stat_database d
WHERE d.datname = current_database()`

export const ACTIVITY_BY_STATE = `
SELECT state, count(*)::int AS n
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state`

export const SESSIONS = `
SELECT pid,
  usename AS "user",
  application_name,
  client_addr::text AS client_addr,
  state,
  wait_event_type,
  wait_event,
  extract(epoch FROM backend_start) * 1000 AS backend_start_ms,
  extract(epoch FROM xact_start)   * 1000 AS xact_start_ms,
  extract(epoch FROM query_start)  * 1000 AS query_start_ms,
  extract(epoch FROM state_change) * 1000 AS state_change_ms,
  query
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
ORDER BY query_start NULLS LAST`

// pg_blocking_pids (PG 9.6+) is the robust way to find blockers.
export const LOCKS = `
SELECT
  a.pid AS blocked_pid, a.usename AS blocked_user, a.query AS blocked_query,
  bl.pid AS blocking_pid, bl.usename AS blocking_user, bl.query AS blocking_query,
  NULL::text AS lock_type
FROM pg_stat_activity a
JOIN LATERAL unnest(pg_blocking_pids(a.pid)) AS blocking(pid) ON true
JOIN pg_stat_activity bl ON bl.pid = blocking.pid
WHERE cardinality(pg_blocking_pids(a.pid)) > 0`

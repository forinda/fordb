import type pg from 'pg'
import type {
  LockRow,
  ServerSnapshot,
  ServerStatsProvider,
  SessionRow
} from '@shared/adapter/stats-types'
import * as SQL from './stats-sql'

const num = (v: unknown): number => Number(v ?? 0)
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export class PgServerStats implements ServerStatsProvider {
  // Reads the live client each call; the adapter owns the connection lifecycle.
  constructor(private readonly conn: () => pg.Client) {}

  async getServerSnapshot(): Promise<ServerSnapshot> {
    const c = this.conn()
    const [snap, states] = await Promise.all([
      c.query(SQL.SNAPSHOT),
      c.query(SQL.ACTIVITY_BY_STATE)
    ])
    const r = (snap.rows[0] ?? {}) as Record<string, unknown>
    const by = { active: 0, idle: 0, idleInTransaction: 0, idleInTransactionAborted: 0, other: 0 }
    for (const row of states.rows as { state: string | null; n: number }[]) {
      if (row.state === 'active') by.active += row.n
      else if (row.state === 'idle') by.idle += row.n
      else if (row.state === 'idle in transaction') by.idleInTransaction += row.n
      else if (row.state === 'idle in transaction (aborted)') by.idleInTransactionAborted += row.n
      else by.other += row.n
    }
    return {
      counters: {
        xactCommit: num(r.xact_commit),
        xactRollback: num(r.xact_rollback),
        blksRead: num(r.blks_read),
        blksHit: num(r.blks_hit),
        tupReturned: num(r.tup_returned),
        tupFetched: num(r.tup_fetched),
        tupInserted: num(r.tup_inserted),
        tupUpdated: num(r.tup_updated),
        tupDeleted: num(r.tup_deleted)
      },
      activityByState: by,
      backends: num(r.backends),
      maxConnections: num(r.max_connections),
      dbSizeBytes: num(r.db_size),
      fullVisibility: r.full_visibility === true
    }
  }

  async getSessions(): Promise<SessionRow[]> {
    const c = this.conn()
    const r = await c.query(SQL.SESSIONS)
    return (r.rows as Record<string, unknown>[]).map((row) => ({
      pid: num(row.pid),
      user: (row.user as string | null) ?? null,
      applicationName: (row.application_name as string | null) ?? null,
      clientAddr: (row.client_addr as string | null) ?? null,
      state: (row.state as string | null) ?? null,
      waitEventType: (row.wait_event_type as string | null) ?? null,
      waitEvent: (row.wait_event as string | null) ?? null,
      backendStartMs: numOrNull(row.backend_start_ms),
      xactStartMs: numOrNull(row.xact_start_ms),
      queryStartMs: numOrNull(row.query_start_ms),
      stateChangeMs: numOrNull(row.state_change_ms),
      query: (row.query as string | null) ?? null
    }))
  }

  async getLocks(): Promise<LockRow[]> {
    const c = this.conn()
    const r = await c.query(SQL.LOCKS)
    return (r.rows as Record<string, unknown>[]).map((row) => ({
      blockedPid: num(row.blocked_pid),
      blockedUser: (row.blocked_user as string | null) ?? null,
      blockedQuery: (row.blocked_query as string | null) ?? null,
      blockingPid: num(row.blocking_pid),
      blockingUser: (row.blocking_user as string | null) ?? null,
      blockingQuery: (row.blocking_query as string | null) ?? null,
      lockType: (row.lock_type as string | null) ?? null
    }))
  }
}

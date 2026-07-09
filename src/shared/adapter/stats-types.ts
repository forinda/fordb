export interface ServerSnapshot {
  counters: {
    xactCommit: number
    xactRollback: number
    blksRead: number
    blksHit: number
    tupReturned: number
    tupFetched: number
    tupInserted: number
    tupUpdated: number
    tupDeleted: number
  }
  activityByState: {
    active: number
    idle: number
    idleInTransaction: number
    idleInTransactionAborted: number
    other: number
  }
  backends: number
  maxConnections: number
  dbSizeBytes: number
  fullVisibility: boolean
}

export interface SessionRow {
  pid: number
  user: string | null
  applicationName: string | null
  clientAddr: string | null
  state: string | null
  waitEventType: string | null
  waitEvent: string | null
  backendStartMs: number | null
  xactStartMs: number | null
  queryStartMs: number | null
  stateChangeMs: number | null
  query: string | null
}

export interface LockRow {
  blockedPid: number
  blockedUser: string | null
  blockedQuery: string | null
  blockingPid: number
  blockingUser: string | null
  blockingQuery: string | null
  lockType: string | null
}

/** Optional read-only server-monitoring capability. Engines that can't provide
 *  it simply omit `DbAdapter.serverStats`. */
export interface ServerStatsProvider {
  getServerSnapshot(): Promise<ServerSnapshot>
  getSessions(): Promise<SessionRow[]>
  getLocks(): Promise<LockRow[]>
}

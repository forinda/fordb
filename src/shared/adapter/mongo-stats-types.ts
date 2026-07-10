export interface MongoSnapshot {
  connections: { current: number; available: number; active: number }
  opcounters: { insert: number; query: number; update: number; delete: number; command: number }
  mem: { residentMb: number; virtualMb: number }
  network: { bytesIn: number; bytesOut: number }
  uptimeSec: number
  repl: { setName: string; primary: boolean; secondary: boolean } | null
}

/** Optional read-only server-monitoring capability (MongoDB). Distinct from the
 *  Postgres `ServerStatsProvider`/`ServerSnapshot` — the shapes don't fit. */
export interface MongoStats {
  serverStatus(): Promise<MongoSnapshot>
}

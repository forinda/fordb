import type { Db } from 'mongodb'
import type { MongoSnapshot, MongoStats } from '@shared/adapter/mongo-stats-types'

/** Maps the (loosely-typed, deployment-dependent) output of
 *  `db.admin().serverStatus()` into `MongoSnapshot`. Defensive `?? 0`/`?? null`
 *  throughout: real serverStatus responses omit sections (e.g. `repl` on a
 *  standalone node) depending on the deployment. */
export class MongoServerStats implements MongoStats {
  constructor(private readonly db: () => Db) {}

  async serverStatus(): Promise<MongoSnapshot> {
    const s = (await this.db().admin().serverStatus()) as Record<string, never>
    const conn = (s.connections ?? {}) as { current?: number; available?: number; active?: number }
    const op = (s.opcounters ?? {}) as Record<string, number>
    const mem = (s.mem ?? {}) as { resident?: number; virtual?: number }
    const net = (s.network ?? {}) as { bytesIn?: number; bytesOut?: number }
    const repl = s.repl as { setName?: string; ismaster?: boolean; secondary?: boolean } | undefined
    return {
      connections: {
        current: conn.current ?? 0,
        available: conn.available ?? 0,
        active: conn.active ?? 0
      },
      opcounters: {
        insert: op.insert ?? 0,
        query: op.query ?? 0,
        update: op.update ?? 0,
        delete: op.delete ?? 0,
        command: op.command ?? 0
      },
      mem: { residentMb: mem.resident ?? 0, virtualMb: mem.virtual ?? 0 },
      network: { bytesIn: net.bytesIn ?? 0, bytesOut: net.bytesOut ?? 0 },
      uptimeSec: Number(s.uptime ?? 0),
      repl: repl
        ? { setName: repl.setName ?? '', primary: !!repl.ismaster, secondary: !!repl.secondary }
        : null
    }
  }
}

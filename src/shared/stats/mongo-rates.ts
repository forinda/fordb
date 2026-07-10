import type { MongoSnapshot } from '../adapter/mongo-stats-types'

export interface OpcounterSample {
  tMs: number
  opcounters: MongoSnapshot['opcounters']
}

export interface OpcounterRatePoint {
  tMs: number
  insert: number
  query: number
  update: number
  delete: number
  command: number
}

/** Per-second rates between two cumulative opcounter samples.
 *
 *  Unlike the Postgres rate helper (`shared/stats/rates.ts`), which drops the
 *  whole point when any counter goes backwards, a Mongo counter reset
 *  (mongod restart resets `opcounters` to 0) clamps that counter's delta to 0
 *  rather than discarding the sample — one bad reading shouldn't blank the
 *  whole rate chart. Returns null only when `dt<=0` (duplicate/out-of-order
 *  sample). */
export function computeOpcounterRate(
  prev: OpcounterSample,
  cur: OpcounterSample
): OpcounterRatePoint | null {
  const dt = (cur.tMs - prev.tMs) / 1000
  if (dt <= 0) return null
  const rate = (k: keyof MongoSnapshot['opcounters']): number =>
    Math.max(0, cur.opcounters[k] - prev.opcounters[k]) / dt
  return {
    tMs: cur.tMs,
    insert: rate('insert'),
    query: rate('query'),
    update: rate('update'),
    delete: rate('delete'),
    command: rate('command')
  }
}

/** Append `s`, then drop samples older than `windowMs` before the newest. */
export function pushOpcounterSample(
  buf: OpcounterSample[],
  s: OpcounterSample,
  windowMs: number
): OpcounterSample[] {
  const next = [...buf, s]
  const cutoff = s.tMs - windowMs
  return next.filter((x) => x.tMs >= cutoff)
}

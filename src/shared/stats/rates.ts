import type { ServerSnapshot } from '../adapter/stats-types'

export interface Sample {
  tMs: number
  counters: ServerSnapshot['counters']
}

export interface RatePoint {
  tMs: number
  tps: number
  cacheHitRatio: number // 0..1
  tuplesPerSec: number
}

const KEYS: (keyof Sample['counters'])[] = [
  'xactCommit',
  'xactRollback',
  'blksRead',
  'blksHit',
  'tupReturned',
  'tupFetched',
  'tupInserted',
  'tupUpdated',
  'tupDeleted'
]

/** Per-second rates between two samples. Null if dt<=0 or any counter dropped
 *  (server restart / pg_stat_reset), to avoid emitting a false spike. */
export function computeRate(prev: Sample, cur: Sample): RatePoint | null {
  const dt = (cur.tMs - prev.tMs) / 1000
  if (dt <= 0) return null
  for (const k of KEYS) if (cur.counters[k] < prev.counters[k]) return null
  const d = (k: keyof Sample['counters']): number => cur.counters[k] - prev.counters[k]
  const hit = d('blksHit')
  const read = d('blksRead')
  const io = hit + read
  const tuples = d('tupInserted') + d('tupUpdated') + d('tupDeleted')
  return {
    tMs: cur.tMs,
    tps: (d('xactCommit') + d('xactRollback')) / dt,
    cacheHitRatio: io === 0 ? 1 : hit / io,
    tuplesPerSec: tuples / dt
  }
}

/** Append `s`, then drop samples older than `windowMs` before the newest. */
export function pushSample(buf: Sample[], s: Sample, windowMs: number): Sample[] {
  const next = [...buf, s]
  const cutoff = s.tMs - windowMs
  return next.filter((x) => x.tMs >= cutoff)
}

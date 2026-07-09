import { useEffect, useMemo, useState } from 'react'
import type { ServerSnapshot } from '@shared/adapter/stats-types'
import { computeRate, pushSample, type RatePoint, type Sample } from '@shared/stats/rates'

export interface ConnPoint {
  tMs: number
  active: number
  idle: number
  idleInTransaction: number
}

/** Keeps an in-memory ring of snapshots (default 5-min window), derives rate
 *  points + connection points for the charts. Resets when connId changes. */
export function useRateHistory(
  connId: string | null,
  snapshot: ServerSnapshot | undefined,
  windowMs = 5 * 60_000
): { rates: RatePoint[]; connections: ConnPoint[] } {
  const [samples, setSamples] = useState<Sample[]>([])
  const [conns, setConns] = useState<ConnPoint[]>([])

  useEffect(() => {
    setSamples([])
    setConns([])
  }, [connId])

  // Append on every new snapshot. useServerSnapshot polls via refetchInterval;
  // React Query's structural sharing keeps the reference stable when the data
  // is unchanged, so this effect only runs on a genuinely new snapshot (and pg
  // stat counters advance on every poll anyway). No manual content-hash dedup —
  // that dropped legitimate polls (freezing the charts during idle) and ignored
  // activityByState (missing state transitions).
  useEffect(() => {
    if (!snapshot) return
    const tMs = performance.now()
    setSamples((buf) => pushSample(buf, { tMs, counters: snapshot.counters }, windowMs))
    setConns((buf) =>
      [
        ...buf,
        {
          tMs,
          active: snapshot.activityByState.active,
          idle: snapshot.activityByState.idle,
          idleInTransaction: snapshot.activityByState.idleInTransaction
        }
      ].filter((p) => p.tMs >= tMs - windowMs)
    )
  }, [snapshot, windowMs])

  const rates = useMemo(() => {
    const out: RatePoint[] = []
    for (let i = 1; i < samples.length; i++) {
      const r = computeRate(samples[i - 1]!, samples[i]!)
      if (r) out.push(r)
    }
    return out
  }, [samples])

  return { rates, connections: conns }
}

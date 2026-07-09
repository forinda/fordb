import { useEffect, useMemo, useRef, useState } from 'react'
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
  // Monotonic clock via a counter of appended snapshots avoids Date.now in
  // render; we still need a real timestamp for dt, taken once per append.
  const lastKey = useRef<string>('')

  useEffect(() => {
    setSamples([])
    setConns([])
    lastKey.current = ''
  }, [connId])

  useEffect(() => {
    if (!snapshot) return
    // Dedup: React Query may return the same object reference across renders.
    const key = JSON.stringify(snapshot.counters) + snapshot.backends
    if (key === lastKey.current) return
    lastKey.current = key
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

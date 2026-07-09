import { describe, it, expect } from 'vitest'
import { computeRate, pushSample, type Sample } from '../../src/shared/stats/rates'

const counters = (over: Partial<Sample['counters']> = {}): Sample['counters'] => ({
  xactCommit: 0,
  xactRollback: 0,
  blksRead: 0,
  blksHit: 0,
  tupReturned: 0,
  tupFetched: 0,
  tupInserted: 0,
  tupUpdated: 0,
  tupDeleted: 0,
  ...over
})

describe('computeRate', () => {
  it('computes per-second rates from the delta over dt', () => {
    const prev: Sample = { tMs: 1000, counters: counters({ xactCommit: 10, blksHit: 100 }) }
    const cur: Sample = {
      tMs: 3000, // 2s later
      counters: counters({ xactCommit: 30, xactRollback: 2, blksHit: 400, blksRead: 100 })
    }
    const r = computeRate(prev, cur)!
    expect(r.tMs).toBe(3000)
    expect(r.tps).toBeCloseTo((30 - 10 + 2) / 2) // (Δcommit+Δrollback)/dt = 22/2 = 11
    expect(r.cacheHitRatio).toBeCloseTo(300 / (300 + 100)) // Δhit/(Δhit+Δread)
  })

  it('returns null when dt is zero', () => {
    const s: Sample = { tMs: 1000, counters: counters({ xactCommit: 5 }) }
    expect(computeRate(s, { ...s, tMs: 1000 })).toBeNull()
  })

  it('returns null when a counter went backwards (server/stats reset)', () => {
    const prev: Sample = { tMs: 1000, counters: counters({ xactCommit: 100 }) }
    const cur: Sample = { tMs: 2000, counters: counters({ xactCommit: 5 }) }
    expect(computeRate(prev, cur)).toBeNull()
  })

  it('cacheHitRatio is 1 when there is no block I/O in the interval', () => {
    const prev: Sample = { tMs: 1000, counters: counters() }
    const cur: Sample = { tMs: 2000, counters: counters() }
    expect(computeRate(prev, cur)!.cacheHitRatio).toBe(1)
  })
})

describe('pushSample', () => {
  it('appends and evicts samples older than the window', () => {
    let buf: Sample[] = []
    buf = pushSample(buf, { tMs: 1000, counters: counters() }, 5000)
    buf = pushSample(buf, { tMs: 4000, counters: counters() }, 5000)
    buf = pushSample(buf, { tMs: 8000, counters: counters() }, 5000)
    // window = last 5000ms up to tMs=8000 → keep >= 3000: drops tMs=1000.
    expect(buf.map((s) => s.tMs)).toEqual([4000, 8000])
  })
})

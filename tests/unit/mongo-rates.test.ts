import { describe, it, expect } from 'vitest'
import {
  computeOpcounterRate,
  pushOpcounterSample,
  type OpcounterSample
} from '../../src/shared/stats/mongo-rates'

const opcounters = (
  over: Partial<OpcounterSample['opcounters']> = {}
): OpcounterSample['opcounters'] => ({
  insert: 0,
  query: 0,
  update: 0,
  delete: 0,
  command: 0,
  ...over
})

describe('computeOpcounterRate', () => {
  it('computes per-second deltas over dt', () => {
    const prev: OpcounterSample = { tMs: 1000, opcounters: opcounters({ query: 100, insert: 10 }) }
    const cur: OpcounterSample = {
      tMs: 3000, // 2s later
      opcounters: opcounters({ query: 300, insert: 30, command: 4 })
    }
    const r = computeOpcounterRate(prev, cur)!
    expect(r.tMs).toBe(3000)
    expect(r.query).toBeCloseTo((300 - 100) / 2)
    expect(r.insert).toBeCloseTo((30 - 10) / 2)
    expect(r.command).toBeCloseTo(4 / 2)
    expect(r.update).toBe(0)
    expect(r.delete).toBe(0)
  })

  it('returns null when dt<=0 (duplicate/out-of-order sample)', () => {
    const s: OpcounterSample = { tMs: 1000, opcounters: opcounters({ query: 5 }) }
    expect(computeOpcounterRate(s, { ...s, tMs: 1000 })).toBeNull()
    expect(computeOpcounterRate(s, { ...s, tMs: 900 })).toBeNull()
  })

  it('clamps a counter reset (mongod restart) to 0 instead of dropping the point', () => {
    const prev: OpcounterSample = {
      tMs: 1000,
      opcounters: opcounters({ query: 500, insert: 50 })
    }
    const cur: OpcounterSample = {
      tMs: 2000,
      opcounters: opcounters({ query: 5, insert: 60 }) // query counter reset, insert kept climbing
    }
    const r = computeOpcounterRate(prev, cur)!
    expect(r.query).toBe(0)
    expect(r.insert).toBeCloseTo(10)
  })

  it('first snapshot has no prior sample — no rate to compute', () => {
    // Simulated at the call-site: with only one sample in the buffer, the
    // consumer's loop (i starts at 1) never calls computeOpcounterRate, so no
    // rate point is emitted for the first snapshot.
    const buf = pushOpcounterSample([], { tMs: 1000, opcounters: opcounters() }, 60_000)
    expect(buf).toHaveLength(1)
  })
})

describe('pushOpcounterSample', () => {
  it('appends and evicts samples older than the window', () => {
    let buf: OpcounterSample[] = []
    buf = pushOpcounterSample(buf, { tMs: 1000, opcounters: opcounters() }, 5000)
    buf = pushOpcounterSample(buf, { tMs: 4000, opcounters: opcounters() }, 5000)
    buf = pushOpcounterSample(buf, { tMs: 8000, opcounters: opcounters() }, 5000)
    expect(buf.map((s) => s.tMs)).toEqual([4000, 8000])
  })
})

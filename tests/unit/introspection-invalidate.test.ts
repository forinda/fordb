import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { qk } from '../../src/renderer/src/query/keys'
import { invalidateIntrospection } from '../../src/renderer/src/query/introspection'

describe('invalidateIntrospection scoping', () => {
  it('invalidates connA metadata but not connB', async () => {
    const qc = new QueryClient()
    // Seed cache entries for two connections.
    qc.setQueryData(qk.schemas('A'), ['app'])
    qc.setQueryData(qk.tables('A', 'app'), [])
    qc.setQueryData(qk.schemas('B'), ['app'])
    await invalidateIntrospection(qc, 'A')
    const stateA = qc.getQueryState(qk.schemas('A'))
    const stateB = qc.getQueryState(qk.schemas('B'))
    expect(stateA?.isInvalidated).toBe(true)
    expect(stateB?.isInvalidated).toBe(false)
  })
})

// tests/unit/ai-tools.test.ts
import { describe, it, expect } from 'vitest'
import { dispatchTool, TOOL_SPECS, GATED_TOOLS } from '../../src/main/ai/tools'
import type { HostApi } from '../../src/shared/host/host-api'
import type { QueryResult } from '../../src/shared/adapter/types'

function fakeHost(): { host: HostApi; calls: string[] } {
  const calls: string[] = []
  const host = {
    listSchemas: async () => {
      calls.push('listSchemas')
      return ['public']
    },
    executeReadOnly: async (_id: string, sql: string): Promise<QueryResult> => {
      calls.push(`ro:${sql}`)
      return { fields: [{ name: 'n', dataType: 'int' }], rows: [[1]], rowCount: 1, command: 'SELECT' }
    }
  } as unknown as HostApi
  return { host, calls }
}

describe('ai tools', () => {
  it('exposes 6 specs and gates only run_query', () => {
    expect(TOOL_SPECS.map((t) => t.function.name).sort()).toEqual([
      'get_columns',
      'get_indexes',
      'get_keys',
      'list_schemas',
      'list_tables',
      'run_query'
    ])
    expect([...GATED_TOOLS]).toEqual(['run_query'])
  })

  it('run_query routes a SELECT through executeReadOnly', async () => {
    const { host, calls } = fakeHost()
    const r = await dispatchTool(host, 'c1', {
      id: 'x',
      name: 'run_query',
      arguments: '{"sql":"SELECT 1"}'
    })
    expect(r.ok).toBe(true)
    expect(calls).toContain('ro:SELECT 1')
  })

  it('run_query rejects a write before HostApi', async () => {
    const { host, calls } = fakeHost()
    const r = await dispatchTool(host, 'c1', {
      id: 'x',
      name: 'run_query',
      arguments: '{"sql":"DELETE FROM t"}'
    })
    expect(r.ok).toBe(false)
    expect(calls).toEqual([]) // executeReadOnly never called
  })

  it('reports a useful outcome on malformed arguments', async () => {
    const { host } = fakeHost()
    const r = await dispatchTool(host, 'c1', { id: 'x', name: 'run_query', arguments: 'not json' })
    expect(r.ok).toBe(false)
  })

  it('list_schemas dispatches to HostApi', async () => {
    const { host, calls } = fakeHost()
    const r = await dispatchTool(host, 'c1', { id: 'x', name: 'list_schemas', arguments: '{}' })
    expect(r.ok).toBe(true)
    expect(calls).toContain('listSchemas')
  })
})

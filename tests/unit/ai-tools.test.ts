// tests/unit/ai-tools.test.ts
import { describe, it, expect } from 'vitest'
import { dispatchTool, TOOL_SPECS, GATED_TOOLS, toolSpecs } from '../../src/main/ai/tools'
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
      return {
        fields: [{ name: 'n', dataType: 'int' }],
        rows: [[1]],
        rowCount: 1,
        command: 'SELECT'
      }
    }
  } as unknown as HostApi
  return { host, calls }
}

describe('ai tools', () => {
  it('exposes 6 read-only specs; gates run_query + run_write', () => {
    expect(TOOL_SPECS.map((t) => t.function.name).sort()).toEqual([
      'get_columns',
      'get_indexes',
      'get_keys',
      'list_schemas',
      'list_tables',
      'run_query'
    ])
    expect([...GATED_TOOLS].sort()).toEqual(['run_query', 'run_write'])
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

  it('toolSpecs gates writes behind the flag', () => {
    const ro = toolSpecs(false).map((t) => t.function.name)
    const rw = toolSpecs(true).map((t) => t.function.name)
    expect(ro).not.toContain('run_write')
    expect(rw).toContain('run_write')
  })

  it('run_write is gated', () => {
    expect(GATED_TOOLS.has('run_write')).toBe(true)
  })

  it('run_write executes via executeQuery (not executeReadOnly)', async () => {
    const wq: string[] = []
    const h = {
      executeQuery: async (_i: string, sql: string): Promise<QueryResult> => {
        wq.push(sql)
        return { fields: [], rows: [], rowCount: 3, command: 'UPDATE' }
      }
    } as unknown as HostApi
    const r = await dispatchTool(h, 'c1', {
      id: 'w',
      name: 'run_write',
      arguments: '{"sql":"UPDATE t SET x=1 WHERE id=2"}'
    })
    expect(r.ok).toBe(true)
    expect(wq).toEqual(['UPDATE t SET x=1 WHERE id=2'])
    expect(r.summary).toMatch(/3 rows/)
  })
})

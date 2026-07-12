// tests/unit/ai-agent.test.ts
import { describe, it, expect } from 'vitest'
import { runAgent, type AgentDeps } from '../../src/main/ai/agent'
import type { StreamEvent, StreamOpts } from '../../src/main/ai/openai-stream'
import type { AiEvent } from '../../src/shared/ai/types'
import type { HostApi } from '../../src/shared/host/host-api'
import type { QueryResult } from '../../src/shared/adapter/types'

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function host(): { host: HostApi; ro: string[] } {
  const ro: string[] = []
  const h = {
    executeReadOnly: async (_i: string, sql: string): Promise<QueryResult> => {
      ro.push(sql)
      return { fields: [], rows: [[1]], rowCount: 1, command: 'SELECT' }
    }
  } as unknown as HostApi
  return { host: h, ro }
}

/** A scripted stream: first call emits a run_query tool call, second emits text. */
function scriptedStream(
  scripts: StreamEvent[][]
): typeof import('../../src/main/ai/openai-stream').streamChat {
  let n = 0
  return async function* (_opts: StreamOpts): AsyncGenerator<StreamEvent> {
    const s = scripts[n++] ?? []
    for (const e of s) yield e
  }
}

function deps(over: Partial<AgentDeps>): { deps: AgentDeps; events: AiEvent[] } {
  const events: AiEvent[] = []
  const base = host()
  return {
    events,
    deps: {
      host: base.host,
      connectionId: 'c1',
      baseUrl: 'http://x/v1',
      apiKey: 'k',
      model: 'm',
      emit: (e) => events.push(e),
      ...over
    }
  }
}

describe('runAgent', () => {
  it('gates run_query: waits for approval, then executes and finishes', async () => {
    const base = host()
    const stream = scriptedStream([
      [{ kind: 'tool', call: { id: 't1', name: 'run_query', arguments: '{"sql":"SELECT 1"}' } }],
      [{ kind: 'text', delta: 'Answer.' }]
    ])
    const { deps: d, events } = deps({ host: base.host, streamImpl: stream })
    const run = runAgent('q', d)
    await flush()
    // Paused for approval; nothing executed yet.
    expect(events.find((e) => e.kind === 'tool-start')).toMatchObject({ gated: true })
    expect(base.ro).toEqual([])
    run.approve('t1', true)
    await flush()
    await flush()
    expect(base.ro).toEqual(['SELECT 1'])
    expect(events.at(-1)).toEqual({ kind: 'done' })
    expect(events).toContainEqual({ kind: 'text', delta: 'Answer.' })
  })

  it('denied run_query is not executed and the model is told', async () => {
    const base = host()
    const stream = scriptedStream([
      [{ kind: 'tool', call: { id: 't1', name: 'run_query', arguments: '{"sql":"SELECT 1"}' } }],
      [{ kind: 'text', delta: 'ok' }]
    ])
    const { deps: d, events } = deps({ host: base.host, streamImpl: stream })
    const run = runAgent('q', d)
    await flush()
    run.approve('t1', false)
    await flush()
    await flush()
    expect(base.ro).toEqual([])
    expect(events).toContainEqual({
      kind: 'tool-result',
      id: 't1',
      ok: false,
      summary: 'denied by user'
    })
    expect(events.at(-1)).toEqual({ kind: 'done' })
  })

  it('a write string is rejected before HostApi (no approval needed to be safe)', async () => {
    const base = host()
    const stream = scriptedStream([
      [
        { kind: 'tool', call: { id: 't1', name: 'run_query', arguments: '{"sql":"DROP TABLE t"}' } }
      ],
      [{ kind: 'text', delta: 'done' }]
    ])
    const { deps: d } = deps({ host: base.host, streamImpl: stream })
    const run = runAgent('q', d)
    await flush()
    run.approve('t1', true)
    await flush()
    await flush()
    expect(base.ro).toEqual([]) // executeReadOnly never called
  })

  it('cancel stops the loop', async () => {
    const stream = scriptedStream([
      [{ kind: 'text', delta: 'partial' }],
      [{ kind: 'text', delta: 'more' }]
    ])
    const { deps: d, events } = deps({ streamImpl: stream })
    const run = runAgent('q', d)
    run.cancel()
    await flush()
    await flush()
    expect(events.at(-1)?.kind === 'error' || events.at(-1)?.kind === 'done').toBe(true)
  })

  it('caps a runaway model that emits a tool call every turn', async () => {
    // Ungated metadata tool → auto-runs, so nothing pauses the loop; without a
    // step cap this would spin forever against the DB + paid endpoint.
    let n = 0
    const infinite: typeof import('../../src/main/ai/openai-stream').streamChat =
      async function* (): AsyncGenerator<StreamEvent> {
        yield {
          kind: 'tool',
          call: { id: `m${n++}`, name: 'list_tables', arguments: '{"schema":"public"}' }
        }
      }
    const { deps: d, events } = deps({ streamImpl: infinite })
    runAgent('q', d)
    for (let i = 0; i < 40; i++) await flush()
    const last = events.at(-1)
    expect(last?.kind).toBe('error')
    expect(last?.kind === 'error' && last.message).toMatch(/steps/)
  })
})

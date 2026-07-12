import { describe, it, expect } from 'vitest'
import { streamChat, type StreamOpts } from '../../src/main/ai/openai-stream'

/** Build a fake fetch returning `chunks` as an SSE ReadableStream (bytes). */
function sseFetch(chunks: string[]): typeof fetch {
  return (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder()
        for (const ch of chunks) c.enqueue(enc.encode(ch))
        c.close()
      }
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as unknown as typeof fetch
}

const base: Omit<StreamOpts, 'fetchImpl'> = {
  baseUrl: 'http://x/v1',
  apiKey: 'k',
  model: 'm',
  messages: [],
  tools: [],
  signal: new AbortController().signal
}

async function collect(opts: StreamOpts): Promise<unknown[]> {
  const out = []
  for await (const e of streamChat(opts)) out.push(e)
  return out
}

describe('streamChat', () => {
  it('yields text deltas from SSE, ignoring [DONE]', async () => {
    const fetchImpl = sseFetch([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: [DONE]\n\n'
    ])
    const events = await collect({ ...base, fetchImpl })
    expect(events).toEqual([
      { kind: 'text', delta: 'Hel' },
      { kind: 'text', delta: 'lo' }
    ])
  })

  it('reassembles a tool call split across deltas', async () => {
    // OpenAI streams tool calls in fragments: first frame carries id+name, later
    // frames carry argument string pieces under the same index.
    const fetchImpl = sseFetch([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"run_query","arguments":"{\\"sql\\":\\"SEL"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ECT 1\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n'
    ])
    const events = await collect({ ...base, fetchImpl })
    expect(events).toEqual([
      { kind: 'tool', call: { id: 'c1', name: 'run_query', arguments: '{"sql":"SELECT 1"}' } }
    ])
  })

  it('handles an SSE event split across two network chunks', async () => {
    const fetchImpl = sseFetch([
      'data: {"choices":[{"delta":{"con',
      'tent":"hi"}}]}\n\n',
      'data: [DONE]\n\n'
    ])
    const events = await collect({ ...base, fetchImpl })
    expect(events).toEqual([{ kind: 'text', delta: 'hi' }])
  })

  it('throws on a non-200 response', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
    await expect(collect({ ...base, fetchImpl })).rejects.toThrow(/401/)
  })

  it('parses CRLF-separated SSE events (non-OpenAI compatible endpoints)', async () => {
    const fetchImpl = sseFetch([
      'data: {"choices":[{"delta":{"content":"a"}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"content":"b"}}]}\r\n\r\n',
      'data: [DONE]\r\n\r\n'
    ])
    const events = await collect({ ...base, fetchImpl })
    expect(events).toEqual([
      { kind: 'text', delta: 'a' },
      { kind: 'text', delta: 'b' }
    ])
  })

  it('emits a usage event from the final include_usage chunk', async () => {
    const fetchImpl = sseFetch([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
      'data: [DONE]\n\n'
    ])
    const events = await collect({ ...base, fetchImpl })
    expect(events).toEqual([
      { kind: 'text', delta: 'hi' },
      { kind: 'usage', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }
    ])
  })

  it('emits no usage event when the endpoint omits it', async () => {
    const fetchImpl = sseFetch([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: [DONE]\n\n'
    ])
    const events = await collect({ ...base, fetchImpl })
    expect(events).toEqual([{ kind: 'text', delta: 'hi' }])
  })
})

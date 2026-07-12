// src/main/ai/openai-stream.ts

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export interface ToolSpec {
  type: 'function'
  function: { name: string; description: string; parameters: unknown }
}

export interface StreamOpts {
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  tools: ToolSpec[]
  signal: AbortSignal
  fetchImpl?: typeof fetch
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type StreamEvent =
  | { kind: 'text'; delta: string }
  | { kind: 'tool'; call: ToolCall }
  | { kind: 'usage'; usage: TokenUsage }

interface Delta {
  content?: string
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[]
}

interface RawUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

/** Stream a chat completion from any OpenAI-compatible endpoint. Reassembles
 *  tool-call fragments (streamed in pieces under a stable index) and yields a
 *  single {kind:'tool'} per completed call after the stream ends. */
export async function* streamChat(opts: StreamOpts): AsyncGenerator<StreamEvent> {
  const doFetch = opts.fetchImpl ?? fetch
  // Serialize tool_calls back to the wire shape the API expects on assistant msgs.
  const messages = opts.messages.map((m) =>
    m.tool_calls
      ? {
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls.map((t) => ({
            id: t.id,
            type: 'function',
            function: { name: t.name, arguments: t.arguments }
          }))
        }
      : { role: m.role, content: m.content, tool_call_id: m.tool_call_id }
  )
  const res = await doFetch(`${opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      stream_options: { include_usage: true },
      messages,
      ...(opts.tools.length ? { tools: opts.tools } : {})
    }),
    signal: opts.signal
  })
  if (!res.ok || !res.body) throw new Error(`AI endpoint error: ${res.status}`)

  const acc = new Map<number, ToolCall>()
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    // SSE events are separated by a blank line — LF or CRLF, since "any
    // OpenAI-compatible endpoint" (proxies, local servers) may emit either.
    let m: RegExpExecArray | null
    while ((m = /\r?\n\r?\n/.exec(buf)) !== null) {
      const event = buf.slice(0, m.index)
      buf = buf.slice(m.index + m[0].length)
      const line = event.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      let parsed: { choices?: { delta?: Delta }[]; usage?: RawUsage }
      try {
        parsed = JSON.parse(data)
      } catch {
        continue
      }
      // The final chunk (include_usage) carries usage with an empty choices array.
      if (parsed.usage) {
        const u = parsed.usage
        yield {
          kind: 'usage',
          usage: {
            promptTokens: u.prompt_tokens ?? 0,
            completionTokens: u.completion_tokens ?? 0,
            totalTokens: u.total_tokens ?? 0
          }
        }
      }
      const delta = parsed.choices?.[0]?.delta
      if (delta?.content) yield { kind: 'text', delta: delta.content }
      for (const tc of delta?.tool_calls ?? []) {
        const cur = acc.get(tc.index) ?? { id: '', name: '', arguments: '' }
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name = tc.function.name
        if (tc.function?.arguments) cur.arguments += tc.function.arguments
        acc.set(tc.index, cur)
      }
    }
  }
  for (const call of acc.values()) yield { kind: 'tool', call }
}

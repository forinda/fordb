// src/main/ai/agent.ts
import type { HostApi } from '@shared/host/host-api'
import type { AiEvent } from '@shared/ai/types'
import { streamChat, type ChatMessage, type StreamEvent, type ToolCall } from './openai-stream'
import { dispatchTool, GATED_TOOLS, TOOL_SPECS } from './tools'

const SYSTEM = [
  'You are a database assistant embedded in fordb.',
  'Use the tools to introspect the schema and run READ-ONLY SQL against the active connection.',
  'You cannot modify data. If the user needs a write, return the SQL for them to run themselves.',
  'Prefer running a query to verify before answering. Answer concisely.'
].join(' ')

export interface AgentDeps {
  host: HostApi
  connectionId: string
  baseUrl: string
  apiKey: string
  model: string
  emit: (e: AiEvent) => void
  streamImpl?: typeof streamChat
}

export interface AgentRun {
  approve(toolId: string, approved: boolean): void
  cancel(): void
}

/** Start one agent turn. Runs to done/error internally; the returned handle
 *  resolves gated tool approvals and cancels. */
export function runAgent(prompt: string, deps: AgentDeps): AgentRun {
  const stream = deps.streamImpl ?? streamChat
  const ac = new AbortController()
  const pending = new Map<string, (approved: boolean) => void>()

  const approve = (toolId: string, approved: boolean): void => {
    pending.get(toolId)?.(approved)
    pending.delete(toolId)
  }
  const cancel = (): void => {
    if (ac.signal.aborted) return
    ac.abort()
    for (const [, resolve] of pending) resolve(false)
    pending.clear()
    // The underlying transport may not observe the abort signal mid-flight
    // (e.g. a scripted/non-fetch stream). Signal completion immediately so
    // callers (UI) never hang on Stop.
    deps.emit({ kind: 'done' })
  }

  const waitApproval = (id: string): Promise<boolean> =>
    new Promise((resolve) => pending.set(id, resolve))

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: prompt }
  ]

  const loop = async (): Promise<void> => {
    for (;;) {
      if (ac.signal.aborted) return
      const calls: ToolCall[] = []
      let text = ''
      const it: AsyncGenerator<StreamEvent> = stream({
        baseUrl: deps.baseUrl,
        apiKey: deps.apiKey,
        model: deps.model,
        messages,
        tools: TOOL_SPECS,
        signal: ac.signal
      })
      for await (const e of it) {
        if (ac.signal.aborted) return
        if (e.kind === 'text') {
          text += e.delta
          deps.emit({ kind: 'text', delta: e.delta })
        } else {
          calls.push(e.call)
        }
      }
      if (ac.signal.aborted) return
      if (calls.length === 0) {
        deps.emit({ kind: 'done' })
        return
      }
      // Record the assistant turn (text + the tool calls it requested).
      messages.push({ role: 'assistant', content: text, tool_calls: calls })
      for (const call of calls) {
        const gated = GATED_TOOLS.has(call.name)
        deps.emit({ kind: 'tool-start', id: call.id, name: call.name, args: call.arguments, gated })
        let approved = true
        if (gated) approved = await waitApproval(call.id)
        if (ac.signal.aborted) return
        const outcome = approved
          ? await dispatchTool(deps.host, deps.connectionId, call)
          : { ok: false, summary: 'denied by user', payload: { error: 'denied by user' } }
        deps.emit({ kind: 'tool-result', id: call.id, ok: outcome.ok, summary: outcome.summary })
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(outcome.payload)
        })
      }
    }
  }

  loop().catch((e) => {
    if (!ac.signal.aborted) deps.emit({ kind: 'error', message: (e as Error).message })
    else deps.emit({ kind: 'done' })
  })

  return { approve, cancel }
}

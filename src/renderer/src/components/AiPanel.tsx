import { useEffect, useRef, useState } from 'react'
import type { AiEvent } from '@shared/ai/types'
import { useConnStore } from '../store'
import { invalidateIntrospection } from '../query/introspection'
import { queryClient } from '../query/client'

interface Step {
  id: string
  name: string
  args: string
  gated: boolean
  destructive?: boolean
  status: 'pending' | 'ran' | 'denied' | 'error'
  summary?: string
}
interface Turn {
  role: 'user' | 'assistant'
  text: string
  steps: Step[]
}

export function AiPanel(): React.JSX.Element {
  const activeConnectionId = useConnStore((s) => s.activeConnectionId)
  // The onEvent effect below has [] deps, so it closes over the mount-time
  // connection id; read the live value through a ref for the post-write refresh.
  const connIdRef = useRef<string | null>(activeConnectionId)
  connIdRef.current = activeConnectionId
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const cur = useRef<Turn | null>(null)

  const patch = (): void => setTurns((t) => [...t.slice(0, -1), { ...(cur.current as Turn) }])

  useEffect(() => {
    return window.fordb.ai.onEvent((e: AiEvent) => {
      const a = cur.current
      if (!a) return
      if (e.kind === 'text') a.text += e.delta
      else if (e.kind === 'tool-start')
        a.steps.push({
          id: e.id,
          name: e.name,
          args: e.args,
          gated: e.gated,
          destructive: e.destructive,
          status: 'pending'
        })
      else if (e.kind === 'tool-result') {
        const st = a.steps.find((s) => s.id === e.id)
        if (st) {
          st.status = e.ok ? 'ran' : st.status === 'pending' ? 'denied' : 'error'
          st.summary = e.summary
        }
        if (e.didWrite && e.ok && connIdRef.current)
          void invalidateIntrospection(queryClient, connIdRef.current)
      } else if (e.kind === 'done' || e.kind === 'error') {
        if (e.kind === 'error') a.text += `\n[error: ${e.message}]`
        setBusy(false)
        cur.current = null
      }
      patch()
    })
  }, [])

  const ask = async (): Promise<void> => {
    if (!input.trim() || !activeConnectionId || busy) return
    setTurns((t) => [...t, { role: 'user', text: input, steps: [] }])
    const assistant: Turn = { role: 'assistant', text: '', steps: [] }
    cur.current = assistant
    setTurns((t) => [...t, assistant])
    setBusy(true)
    const prompt = input
    setInput('')
    await window.fordb.ai.ask(prompt, activeConnectionId)
  }

  const decide = (id: string, ok: boolean): void => {
    const st = cur.current?.steps.find((s) => s.id === id)
    if (st && !ok) st.status = 'denied'
    void window.fordb.ai.approve(id, ok)
    patch()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 text-sm">
        {!activeConnectionId && (
          <div className="text-muted-foreground">Connect to a database to use the assistant.</div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? 'font-medium' : ''}>
            {t.text && <div className="whitespace-pre-wrap">{t.text}</div>}
            {t.steps.map((s) => (
              <div
                key={s.id}
                className="my-1 rounded border border-border bg-surface-2 p-2 text-xs"
              >
                <div className="font-mono">
                  {s.name}
                  {s.name === 'run_query' || s.name === 'run_write'
                    ? `: ${JSON.parse(s.args || '{}').sql ?? ''}`
                    : ''}
                </div>
                {s.status === 'pending' && s.gated ? (
                  <PendingControls step={s} onDecide={decide} />
                ) : (
                  <div className="mt-1 text-muted-foreground">
                    {s.status === 'pending'
                      ? 'running…'
                      : `${s.status}${s.summary ? ` · ${s.summary}` : ''}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-border p-2">
        <input
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
          value={input}
          disabled={!activeConnectionId}
          placeholder="Ask about this database…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void ask()}
        />
        {busy ? (
          <button
            className="rounded border border-border px-2 py-1 text-sm"
            onClick={() => void window.fordb.ai.cancel()}
          >
            Stop
          </button>
        ) : (
          <button
            className="rounded border border-primary px-2 py-1 text-sm"
            disabled={!activeConnectionId}
            onClick={() => void ask()}
          >
            Ask
          </button>
        )}
      </div>
    </div>
  )
}

function PendingControls(props: {
  step: Step
  onDecide: (id: string, ok: boolean) => void
}): React.JSX.Element {
  const { step, onDecide } = props
  const [ack, setAck] = useState(false)
  const danger = step.name === 'run_write' && step.destructive
  return (
    <div className="mt-1 flex flex-col gap-1">
      {danger && (
        <label className="flex items-center gap-1 text-destructive">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I
          understand this modifies or deletes data
        </label>
      )}
      <div className="flex gap-2">
        <button
          className={`rounded border px-2 py-0.5 ${danger ? 'border-destructive text-destructive' : 'border-primary'}`}
          disabled={danger && !ack}
          onClick={() => onDecide(step.id, true)}
        >
          Run
        </button>
        <button
          className="rounded border border-border px-2 py-0.5"
          onClick={() => onDecide(step.id, false)}
        >
          Deny
        </button>
      </div>
    </div>
  )
}

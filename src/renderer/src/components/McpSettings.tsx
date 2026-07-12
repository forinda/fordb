import { useEffect, useState } from 'react'
import type { McpStatus } from '@shared/mcp/types'

/** Local MCP server controls: enable, port, bearer token. Off by default; the
 *  server binds 127.0.0.1 only and exposes only connections marked "Expose to
 *  MCP" while they are open. Rendered as a section inside Preferences. */
export function McpSection(): React.JSX.Element {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [port, setPort] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.fordb.mcp.status().then((s) => {
      setStatus(s)
      setPort(String(s.port))
    })
  }, [])

  const run = async (fn: () => Promise<McpStatus>): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await fn())
    } finally {
      setBusy(false)
    }
  }

  const savePort = async (): Promise<void> => {
    const n = Number(port)
    if (!Number.isInteger(n) || n < 1 || n > 65535) return
    await run(() => window.fordb.mcp.setPort(n))
  }

  const copyToken = (): void => {
    if (!status) return
    void navigator.clipboard.writeText(status.token)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!status) return <div className="text-sm text-muted-foreground">Loading…</div>

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        Let AI agents (Claude Desktop, Cursor, …) introspect schemas and run{' '}
        <strong>read-only</strong> queries against connections you mark “Expose to MCP”. Binds{' '}
        <code>127.0.0.1</code> only; requires the bearer token below.
      </p>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          disabled={busy}
          checked={status.enabled}
          onChange={(e) => run(() => window.fordb.mcp.setEnabled(e.target.checked))}
        />
        <span>
          Enable MCP server{' '}
          <span className={status.running ? 'text-success' : 'text-muted-foreground'}>
            ({status.running ? 'running' : 'stopped'})
          </span>
        </span>
      </label>

      <label className="flex items-center gap-2">
        <span className="w-28">Port</span>
        <input
          className="w-28 rounded border border-border bg-background px-2 py-1"
          value={port}
          disabled={busy}
          onChange={(e) => setPort(e.target.value)}
          onBlur={savePort}
          inputMode="numeric"
        />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground">Bearer token</span>
        <div className="flex items-center gap-2">
          <input
            readOnly
            className="min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 py-1 font-mono text-xs"
            value={status.token}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            className="flex-none rounded border border-border px-2 py-1 hover:bg-surface-2"
            onClick={copyToken}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            className="flex-none rounded border border-border px-2 py-1 hover:bg-surface-2"
            disabled={busy}
            onClick={() => run(() => window.fordb.mcp.regenerateToken())}
            title="Invalidate the current token and issue a new one"
          >
            Regenerate
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Point your agent at <code>http://127.0.0.1:{status.port}/</code> with header{' '}
        <code>Authorization: Bearer &lt;token&gt;</code>.
      </p>
    </div>
  )
}

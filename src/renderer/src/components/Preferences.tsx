import { useEffect, useState } from 'react'
import type { ThemeMode } from '@shared/theme'
import { useThemeStore } from '../store-theme'
import { useUpdaterStore } from '../store-updater'
import { Modal } from './ui/modal'
import { McpSection } from './McpSettings'

const THEMES: ThemeMode[] = ['system', 'light', 'dark']

function Section(props: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2 border-b border-border pb-4 last:border-0 last:pb-0">
      <h3 className="text-sm font-semibold">{props.title}</h3>
      {props.children}
    </section>
  )
}

function AppearanceSection(): React.JSX.Element {
  const mode = useThemeStore((s) => s.mode)
  const setMode = useThemeStore((s) => s.setMode)
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-28">Theme</span>
      <div className="flex gap-1">
        {THEMES.map((t) => (
          <button
            key={t}
            onClick={() => void setMode(t)}
            className={`rounded border px-2 py-1 capitalize ${
              mode === t ? 'border-primary bg-surface-2' : 'border-border hover:bg-surface-2'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
    </label>
  )
}

function UpdatesSection(): React.JSX.Element {
  const status = useUpdaterStore((s) => s.status)
  const [auto, setAuto] = useState<boolean | null>(null)

  useEffect(() => {
    void window.fordb.updater.getAuto().then(setAuto)
  }, [])

  const toggle = (v: boolean): void => {
    setAuto(v)
    void window.fordb.updater.setAuto(v)
  }

  const label: Record<string, string> = {
    idle: '',
    checking: 'Checking…',
    available: `Update available: ${status.status === 'available' ? status.version : ''}`,
    downloading: `Downloading… ${status.status === 'downloading' ? status.percent : 0}%`,
    downloaded: 'Update ready — restart to install',
    'not-available': 'Up to date',
    unsupported: 'Auto-update not supported on this build',
    error: status.status === 'error' ? `Error: ${status.message}` : 'Error'
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={auto ?? true}
          disabled={auto === null}
          onChange={(e) => toggle(e.target.checked)}
        />
        Automatically check for updates on launch
      </label>
      <div className="flex items-center gap-2">
        <button
          className="rounded border border-border px-2 py-1 hover:bg-surface-2"
          onClick={() => void window.fordb.updater.check()}
        >
          Check now
        </button>
        {status.status === 'downloaded' && (
          <button
            className="rounded border border-primary px-2 py-1 hover:bg-surface-2"
            onClick={() => void window.fordb.updater.install()}
          >
            Restart &amp; install
          </button>
        )}
        <span className="text-muted-foreground">{label[status.status]}</span>
      </div>
    </div>
  )
}

function AiConfigSection(): React.JSX.Element {
  const [cfg, setCfg] = useState<{ baseUrl: string; model: string; hasKey: boolean } | null>(null)
  const [key, setKey] = useState('')
  const [test, setTest] = useState('')
  useEffect(() => {
    void window.fordb.ai.getConfig().then(setCfg)
  }, [])
  if (!cfg) return <div className="text-sm text-muted-foreground">Loading…</div>
  const save = (patch: Partial<typeof cfg>): void => {
    const next = { ...cfg, ...patch }
    setCfg(next)
    void window.fordb.ai.setConfig(next.baseUrl, next.model)
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">
        Any OpenAI-compatible endpoint (OpenAI, OpenRouter, Ollama at{' '}
        <code>http://localhost:11434/v1</code>, …). The key is stored in your OS keychain.
      </p>
      <label className="flex items-center gap-2">
        <span className="w-20">Base URL</span>
        <input
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1"
          value={cfg.baseUrl}
          placeholder="https://api.openai.com/v1"
          onChange={(e) => save({ baseUrl: e.target.value })}
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="w-20">Model</span>
        <input
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1"
          value={cfg.model}
          placeholder="gpt-4o-mini / llama3.1 / …"
          onChange={(e) => save({ model: e.target.value })}
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="w-20">API key</span>
        <input
          type="password"
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs"
          value={key}
          placeholder={cfg.hasKey ? '•••• (saved)' : 'sk-… (blank for keyless Ollama)'}
          onChange={(e) => setKey(e.target.value)}
          onBlur={() => void window.fordb.ai.setKey(key)}
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          className="rounded border border-border px-2 py-1 hover:bg-surface-2"
          onClick={async () => {
            const r = await window.fordb.ai.test()
            setTest(r.ok ? 'OK' : `Failed: ${r.message}`)
          }}
        >
          Test
        </button>
        <span className="text-muted-foreground">{test}</span>
      </div>
    </div>
  )
}

function AboutSection(): React.JSX.Element {
  const [version, setVersion] = useState('')
  useEffect(() => {
    void window.fordb.appVersion().then(setVersion)
  }, [])
  return (
    <div className="text-sm text-muted-foreground">
      <div>
        <strong className="text-foreground">fordb</strong> {version && `v${version}`}
      </div>
      <div>Lean, keyboard-first desktop database client — MIT.</div>
    </div>
  )
}

export function Preferences(props: { open: boolean; onClose: () => void }): React.JSX.Element {
  return (
    <Modal open={props.open} onClose={props.onClose} title="Preferences">
      <div className="flex flex-col gap-4">
        <Section title="Appearance">
          <AppearanceSection />
        </Section>
        <Section title="Updates">
          <UpdatesSection />
        </Section>
        <Section title="MCP server">
          <McpSection />
        </Section>
        <Section title="AI assistant">
          <AiConfigSection />
        </Section>
        <Section title="About">
          <AboutSection />
        </Section>
      </div>
    </Modal>
  )
}

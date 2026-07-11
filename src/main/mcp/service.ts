import { randomBytes } from 'node:crypto'
import { startMcpServer, type McpConnectionInfo, type RunningMcp } from './server'
import type { HostApi } from '@shared/host/host-api'
import type { SettingsStore } from '../settings-store'
import type { SecretStore } from '../secret-store'

/** Reserved SecretStore id under which the MCP bearer token lives (keychain). */
const TOKEN_ID = '__mcp__'

export interface McpStatus {
  enabled: boolean
  port: number
  running: boolean
  /** The bearer token, surfaced to the settings UI so the user can copy it into
   *  their agent's config. It never leaves the local machine otherwise. */
  token: string
}

/** Owns the MCP server lifecycle + its keychain-backed token. Bound to 127.0.0.1
 *  only — never exposed off the loopback interface. */
export class McpService {
  private running: RunningMcp | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly secrets: SecretStore,
    private readonly getHost: () => HostApi | null,
    private readonly connections: () => McpConnectionInfo[] | Promise<McpConnectionInfo[]>
  ) {}

  private async token(): Promise<string> {
    const cur = (await this.secrets.get(TOKEN_ID)).authToken
    if (cur) return cur
    return this.newToken()
  }

  private async newToken(): Promise<string> {
    const t = randomBytes(24).toString('base64url')
    await this.secrets.set(TOKEN_ID, { authToken: t })
    return t
  }

  async status(): Promise<McpStatus> {
    const c = await this.settings.getMcp()
    return { enabled: c.enabled, port: c.port, running: this.running !== null, token: await this.token() }
  }

  /** Reconcile the running server with the persisted settings. Idempotent. */
  async sync(): Promise<void> {
    const c = await this.settings.getMcp()
    if (c.enabled) await this.start(c.port)
    else await this.stop()
  }

  async setEnabled(enabled: boolean): Promise<McpStatus> {
    const c = await this.settings.getMcp()
    await this.settings.setMcp({ ...c, enabled })
    await this.sync()
    return this.status()
  }

  async setPort(port: number): Promise<McpStatus> {
    const c = await this.settings.getMcp()
    await this.settings.setMcp({ ...c, port })
    await this.restart()
    return this.status()
  }

  async regenerateToken(): Promise<McpStatus> {
    await this.newToken()
    await this.restart() // pick up the new token
    return this.status()
  }

  private async start(port: number): Promise<void> {
    if (this.running) return
    const host = this.getHost()
    if (!host) return // db-host not ready yet; a later sync() will start it
    const token = await this.token()
    this.running = await startMcpServer(
      { host, token, connections: this.connections },
      '127.0.0.1',
      port
    )
  }

  async stop(): Promise<void> {
    if (!this.running) return
    await this.running.stop()
    this.running = null
  }

  /** Restart only if currently running (settings unchanged otherwise). */
  private async restart(): Promise<void> {
    if (!this.running) return
    await this.stop()
    await this.sync()
  }
}

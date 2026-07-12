import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ThemeMode } from '@shared/theme'

const MODES: ReadonlySet<string> = new Set(['light', 'dark', 'system'])

interface SettingsFile {
  theme?: string
  mcpEnabled?: boolean
  mcpPort?: number
  autoUpdate?: boolean
  aiBaseUrl?: string
  aiModel?: string
}

/** Non-secret MCP settings. The bearer TOKEN is a credential (grants DB read
 *  access) and is stored in the OS keychain via SecretStore — never here. */
export interface McpSettings {
  enabled: boolean
  port: number
}

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  private async read(): Promise<SettingsFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as SettingsFile
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw err
    }
  }

  async getTheme(): Promise<ThemeMode> {
    const raw = (await this.read()).theme
    return raw && MODES.has(raw) ? (raw as ThemeMode) : 'system'
  }

  async setTheme(mode: ThemeMode): Promise<void> {
    const data = await this.read()
    data.theme = mode
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }

  async getMcp(): Promise<McpSettings> {
    const raw = await this.read()
    return { enabled: raw.mcpEnabled ?? false, port: raw.mcpPort ?? 8283 }
  }

  async setMcp(c: McpSettings): Promise<void> {
    const data = await this.read()
    data.mcpEnabled = c.enabled
    data.mcpPort = c.port
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }

  /** In-app auto-update opt-in (default on). Only takes effect where updates are
   *  supported at all — packaged AppImage/NSIS. */
  async getAutoUpdate(): Promise<boolean> {
    return (await this.read()).autoUpdate ?? true
  }

  async setAutoUpdate(enabled: boolean): Promise<void> {
    const data = await this.read()
    data.autoUpdate = enabled
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }

  async getAi(): Promise<{ baseUrl: string; model: string }> {
    const raw = await this.read()
    return { baseUrl: raw.aiBaseUrl ?? '', model: raw.aiModel ?? '' }
  }

  async setAi(c: { baseUrl: string; model: string }): Promise<void> {
    const data = await this.read()
    data.aiBaseUrl = c.baseUrl
    data.aiModel = c.model
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }
}

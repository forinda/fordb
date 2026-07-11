import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ThemeMode } from '@shared/theme'
import type { McpConfig } from '@shared/mcp/auth'

const MODES: ReadonlySet<string> = new Set(['light', 'dark', 'system'])

interface SettingsFile {
  theme?: string
  mcpEnabled?: boolean
  mcpPort?: number
  mcpToken?: string
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

  async getMcp(): Promise<McpConfig> {
    const raw = await this.read()
    return {
      enabled: raw.mcpEnabled ?? false,
      port: raw.mcpPort ?? 8283,
      token: raw.mcpToken ?? ''
    }
  }

  async setMcp(c: McpConfig): Promise<void> {
    const data = await this.read()
    data.mcpEnabled = c.enabled
    data.mcpPort = c.port
    data.mcpToken = c.token
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }
}

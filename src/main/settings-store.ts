import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ThemeMode } from '../shared/theme'

const MODES: ReadonlySet<string> = new Set(['light', 'dark', 'system'])

interface SettingsFile {
  theme?: string
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
}

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface HistoryEntry {
  sql: string
  ts: number
}
export interface SavedQuery {
  id: string
  name: string
  sql: string
  createdAt: number
}
interface LibraryFile {
  history?: Record<string, HistoryEntry[]>
  saved?: Record<string, SavedQuery[]>
  counter?: number
}

const HISTORY_CAP = 200

/** Per-profile query history + named saved queries in one JSON file. SQL text
 *  only — never secret-bearing (same trust boundary as profiles-minus-secrets). */
export class QueryLibraryStore {
  constructor(private readonly filePath: string) {}

  private async read(): Promise<LibraryFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as LibraryFile
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw err
    }
  }
  private async write(data: LibraryFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }

  async addHistory(profileId: string, sql: string): Promise<void> {
    const data = await this.read()
    const list = data.history?.[profileId] ?? []
    if (list[0]?.sql === sql) return // dedup consecutive
    const next = [{ sql, ts: Date.now() }, ...list].slice(0, HISTORY_CAP)
    data.history = { ...data.history, [profileId]: next }
    await this.write(data)
  }
  async listHistory(profileId: string): Promise<HistoryEntry[]> {
    return (await this.read()).history?.[profileId] ?? []
  }
  async saveQuery(profileId: string, name: string, sql: string): Promise<SavedQuery> {
    const data = await this.read()
    const counter = (data.counter ?? 0) + 1
    const q: SavedQuery = { id: `s${counter}`, name, sql, createdAt: Date.now() }
    data.counter = counter
    data.saved = { ...data.saved, [profileId]: [...(data.saved?.[profileId] ?? []), q] }
    await this.write(data)
    return q
  }
  async listSaved(profileId: string): Promise<SavedQuery[]> {
    return (await this.read()).saved?.[profileId] ?? []
  }
  async deleteSaved(profileId: string, id: string): Promise<void> {
    const data = await this.read()
    if (!data.saved?.[profileId]) return
    data.saved[profileId] = data.saved[profileId].filter((q) => q.id !== id)
    await this.write(data)
  }
}

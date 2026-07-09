import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { HistoryEntry, SavedQuery } from '@shared/query/library-types'

export type { HistoryEntry, SavedQuery }

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

  // Serialize every read-modify-write so concurrent addHistory calls (fired on
  // every successful query run) can't interleave read→write and clobber each
  // other. Each mutator runs after the previous op settles.
  private chain: Promise<unknown> = Promise.resolve()
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.then(
      () => {},
      () => {}
    )
    return run
  }

  private async read(): Promise<LibraryFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as LibraryFile
    } catch (err) {
      // Missing OR corrupt file → treat as empty rather than throwing to an ipc
      // handler (which would become an unhandled rejection in the renderer).
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      console.warn(`query-library: unreadable ${this.filePath}, starting empty`, err)
      return {}
    }
  }
  private async write(data: LibraryFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    // Atomic write: a mid-write crash can't leave a half-written (corrupt) file.
    const tmp = `${this.filePath}.tmp`
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    await rename(tmp, this.filePath)
  }

  addHistory(profileId: string, sql: string): Promise<void> {
    return this.serialize(async () => {
      const data = await this.read()
      const list = data.history?.[profileId] ?? []
      if (list[0]?.sql === sql) return // dedup consecutive
      const next = [{ sql, ts: Date.now() }, ...list].slice(0, HISTORY_CAP)
      data.history = { ...data.history, [profileId]: next }
      await this.write(data)
    })
  }
  async listHistory(profileId: string): Promise<HistoryEntry[]> {
    return (await this.read()).history?.[profileId] ?? []
  }
  saveQuery(profileId: string, name: string, sql: string): Promise<SavedQuery> {
    return this.serialize(async () => {
      const data = await this.read()
      const counter = (data.counter ?? 0) + 1
      const q: SavedQuery = { id: `s${counter}`, name, sql, createdAt: Date.now() }
      data.counter = counter
      data.saved = { ...data.saved, [profileId]: [...(data.saved?.[profileId] ?? []), q] }
      await this.write(data)
      return q
    })
  }
  async listSaved(profileId: string): Promise<SavedQuery[]> {
    return (await this.read()).saved?.[profileId] ?? []
  }
  deleteSaved(profileId: string, id: string): Promise<void> {
    return this.serialize(async () => {
      const data = await this.read()
      if (!data.saved?.[profileId]) return
      data.saved[profileId] = data.saved[profileId].filter((q) => q.id !== id)
      await this.write(data)
    })
  }
}

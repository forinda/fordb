// src/main/conversation-store.ts
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Conversation, ConversationSummary } from '@shared/ai/conversation-types'

interface ConversationsFile {
  byProfile?: Record<string, Conversation[]>
}

/** Per-profile AI conversation transcripts in one JSON file. Chat text + tool-step
 *  metadata only — no secrets, no result-row payloads (same boundary as the query
 *  library). Mirrors QueryLibraryStore: serialized read-modify-write + atomic write. */
export class ConversationStore {
  constructor(private readonly filePath: string) {}

  private chain: Promise<unknown> = Promise.resolve()
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.then(
      () => {},
      () => {}
    )
    return run
  }

  private async read(): Promise<ConversationsFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as ConversationsFile
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      console.warn(`conversation-store: unreadable ${this.filePath}, starting empty`, err)
      return {}
    }
  }

  private async write(data: ConversationsFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    await rename(tmp, this.filePath)
  }

  async list(profileId: string): Promise<ConversationSummary[]> {
    const all = (await this.read()).byProfile?.[profileId] ?? []
    return all
      .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(profileId: string, id: string): Promise<Conversation | null> {
    const all = (await this.read()).byProfile?.[profileId] ?? []
    return all.find((c) => c.id === id) ?? null
  }

  save(profileId: string, c: Conversation): Promise<void> {
    return this.serialize(async () => {
      const data = await this.read()
      const byProfile = data.byProfile ?? {}
      const list = byProfile[profileId] ?? []
      const i = list.findIndex((x) => x.id === c.id)
      if (i === -1) list.unshift(c)
      else list[i] = c
      byProfile[profileId] = list
      await this.write({ byProfile })
    })
  }

  delete(profileId: string, id: string): Promise<void> {
    return this.serialize(async () => {
      const data = await this.read()
      const byProfile = data.byProfile ?? {}
      byProfile[profileId] = (byProfile[profileId] ?? []).filter((c) => c.id !== id)
      await this.write({ byProfile })
    })
  }
}

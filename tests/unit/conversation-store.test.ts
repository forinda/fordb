import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConversationStore } from '../../src/main/conversation-store'
import type { Conversation } from '../../src/shared/ai/conversation-types'

function conv(id: string, title: string, updatedAt: number): Conversation {
  return { id, title, updatedAt, turns: [{ role: 'user', text: title, steps: [] }] }
}

describe('ConversationStore', () => {
  let store: ConversationStore
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'fordb-conv-'))
    store = new ConversationStore(join(dir, 'conversations.json'))
  })

  it('lists empty for a missing file', async () => {
    expect(await store.list('p1')).toEqual([])
  })

  it('saves and gets a conversation round-trip', async () => {
    const c = conv('a', 'hello', 100)
    await store.save('p1', c)
    expect(await store.get('p1', 'a')).toEqual(c)
  })

  it('upserts by id (no duplicate)', async () => {
    await store.save('p1', conv('a', 'v1', 100))
    await store.save('p1', conv('a', 'v2', 200))
    const list = await store.list('p1')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'a', title: 'v2', updatedAt: 200 })
  })

  it('lists summaries newest-updatedAt first', async () => {
    await store.save('p1', conv('a', 'old', 100))
    await store.save('p1', conv('b', 'new', 300))
    await store.save('p1', conv('c', 'mid', 200))
    expect((await store.list('p1')).map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })

  it('deletes a conversation', async () => {
    await store.save('p1', conv('a', 'x', 100))
    await store.delete('p1', 'a')
    expect(await store.list('p1')).toEqual([])
    expect(await store.get('p1', 'a')).toBeNull()
  })

  it('isolates conversations per profile', async () => {
    await store.save('p1', conv('a', 'x', 100))
    await store.save('p2', conv('b', 'y', 100))
    expect((await store.list('p1')).map((s) => s.id)).toEqual(['a'])
    expect((await store.list('p2')).map((s) => s.id)).toEqual(['b'])
  })
})

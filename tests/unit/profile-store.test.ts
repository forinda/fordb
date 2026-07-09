import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProfileStore } from '../../src/main/profile-store'
import type { ConnectionProfile } from '../../src/shared/adapter/types'

const base: ConnectionProfile = {
  id: 'p1',
  name: 'local',
  engine: 'postgres',
  host: 'localhost',
  port: 5432,
  database: 'db',
  user: 'u',
  password: 'secret'
}

let dir: string
let store: ProfileStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fordb-'))
  store = new ProfileStore(join(dir, 'profiles.json'))
})

describe('ProfileStore', () => {
  it('returns empty list when file absent', async () => {
    expect(await store.list()).toEqual([])
  })
  it('save strips secrets before persisting', async () => {
    await store.save(base)
    const [p] = await store.list()
    expect(p).toBeDefined()
    expect(p!.id).toBe('p1')
    const secrets = p as { password?: string; sshPassword?: string; sshPassphrase?: string }
    expect(secrets.password).toBeUndefined()
    expect(secrets.sshPassword).toBeUndefined()
    expect(secrets.sshPassphrase).toBeUndefined()
  })
  it('strips the SQLite auth token before persisting (remote)', async () => {
    await store.save({
      id: 's1',
      name: 'remote',
      engine: 'sqlite',
      kind: 'remote',
      url: 'libsql://x',
      authToken: 'secret-token'
    })
    const [p] = await store.list()
    expect((p as { authToken?: string }).authToken).toBeUndefined()
    expect((p as { url?: string }).url).toBe('libsql://x')
  })
  it('normalizes a legacy kind-less SQLite profile to local on read', async () => {
    // Simulate a profile saved before the local/remote/replica split.
    await writeFile(
      join(dir, 'profiles.json'),
      JSON.stringify([{ id: 'legacy', name: 'old', engine: 'sqlite', file: '/tmp/a.db' }]),
      'utf8'
    )
    const [p] = await store.list()
    expect(p).toMatchObject({ id: 'legacy', engine: 'sqlite', kind: 'local', file: '/tmp/a.db' })
  })
  it('save upserts by id', async () => {
    await store.save(base)
    await store.save({ ...base, name: 'renamed' })
    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.name).toBe('renamed')
  })
  it('delete removes by id', async () => {
    await store.save(base)
    await store.delete('p1')
    expect(await store.list()).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })
  it('auto-suffixes a duplicate name from a different profile', async () => {
    await store.save({ ...base, id: 'a', name: 'db' })
    await store.save({ ...base, id: 'b', name: 'db' })
    await store.save({ ...base, id: 'c', name: 'db' })
    const names = (await store.list()).map((p) => p.name).sort()
    expect(names).toEqual(['db', 'db (2)', 'db (3)'])
  })
  it('editing a profile keeps its own name (no self-collision suffix)', async () => {
    await store.save({ ...base, id: 'a', name: 'db' })
    await store.save({ ...base, id: 'a', name: 'db', host: 'changed' })
    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.name).toBe('db')
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
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
    expect(p!.password).toBeUndefined()
    expect(p!.sshPassword).toBeUndefined()
    expect(p!.sshPassphrase).toBeUndefined()
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
})

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ConnectionProfile } from '../shared/adapter/types'

export class ProfileStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<ConnectionProfile[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return JSON.parse(raw) as ConnectionProfile[]
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  async save(profile: ConnectionProfile): Promise<void> {
    const { password: _pw, sshPassword: _sp, sshPassphrase: _pp, ...safe } = profile
    void _pw
    void _sp
    void _pp
    const list = await this.list()
    const idx = list.findIndex((p) => p.id === profile.id)
    if (idx >= 0) list[idx] = safe
    else list.push(safe)
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(list, null, 2), 'utf8')
  }

  async delete(id: string): Promise<void> {
    const list = (await this.list()).filter((p) => p.id !== id)
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(list, null, 2), 'utf8')
  }
}

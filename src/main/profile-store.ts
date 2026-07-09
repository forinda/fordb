import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ConnectionProfile } from '@shared/adapter/types'

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
    // Strip secrets before persisting. SQLite is structurally secretless;
    // Postgres secrets are dropped by destructuring, so a new secret field on
    // PostgresProfile fails to compile here until it's handled.
    let safe: ConnectionProfile
    if (profile.engine === 'postgres') {
      const { password: _pw, sshPassword: _sp, sshPassphrase: _pp, ...rest } = profile
      void _pw
      void _sp
      void _pp
      safe = rest
    } else {
      safe = { ...profile }
    }
    const list = await this.list()
    // Keep display names distinguishable: if another profile already uses this
    // name, append " (2)", " (3)", … Duplicates are only confusing, not invalid,
    // so we disambiguate rather than reject.
    const taken = new Set(list.filter((p) => p.id !== safe.id).map((p) => p.name))
    if (taken.has(safe.name)) {
      let n = 2
      while (taken.has(`${safe.name} (${n})`)) n += 1
      safe.name = `${safe.name} (${n})`
    }
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

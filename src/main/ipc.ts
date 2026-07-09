import { ipcMain, safeStorage, app, dialog } from 'electron'
import { join } from 'node:path'
import { ProfileStore } from './profile-store'
import { SecretStore, type SafeStorageLike } from './secret-store'
import type { ConnectionProfile } from '@shared/adapter/types'
import type { HostApi } from '@shared/host/host-api'

export function registerIpc(getHostControl: () => HostApi | null): void {
  const dir = app.getPath('userData')
  const profiles = new ProfileStore(join(dir, 'profiles.json'))
  const secrets = new SecretStore(
    join(dir, 'secrets.json'),
    safeStorage as unknown as SafeStorageLike
  )

  ipcMain.handle('profiles:list', () => profiles.list())
  ipcMain.handle(
    'profiles:save',
    async (
      _e,
      profile: ConnectionProfile,
      secretFields: {
        password?: string
        sshPassword?: string
        sshPassphrase?: string
        authToken?: string
      }
    ) => {
      await profiles.save(profile)
      if (
        secretFields.password ||
        secretFields.sshPassword ||
        secretFields.sshPassphrase ||
        secretFields.authToken
      ) {
        await secrets.set(profile.id, secretFields)
      }
    }
  )
  ipcMain.handle('profiles:delete', async (_e, id: string) => {
    await profiles.delete(id)
    await secrets.delete(id)
  })

  // Load the persisted (secret-stripped) profile and merge back the
  // decrypted secrets kept separately in SecretStore. This merged profile is
  // only ever handed to hostControl (main-side); it must never be returned
  // to a renderer-facing ipcMain.handle.
  async function hydrate(id: string): Promise<ConnectionProfile> {
    const all = await profiles.list()
    const profile = all.find((p) => p.id === id)
    if (!profile) throw new Error(`Unknown profile: ${id}`)
    // Postgres carries password/ssh secrets; SQLite remote/replica carry an
    // auth token. Local SQLite is secretless.
    if (profile.engine === 'postgres') {
      const s = await secrets.get(id)
      return {
        ...profile,
        password: s.password,
        sshPassword: s.sshPassword,
        sshPassphrase: s.sshPassphrase
      }
    }
    if (profile.engine === 'sqlite' && (profile.kind === 'remote' || profile.kind === 'replica')) {
      const s = await secrets.get(id)
      return { ...profile, authToken: s.authToken }
    }
    return profile
  }

  ipcMain.handle('connection:test', async (_e, profileId: string) => {
    const host = getHostControl()
    if (!host) throw new Error('db-host unavailable')
    return host.testConnection(await hydrate(profileId))
  })
  ipcMain.handle('connection:open', async (_e, profileId: string, overrideDatabase?: string) => {
    const host = getHostControl()
    if (!host) throw new Error('db-host unavailable')
    const profile = await hydrate(profileId)
    // Switching databases on the same Postgres server = reopen the profile
    // against a different `database` (a live pg connection can't change db).
    const eff =
      overrideDatabase && profile.engine === 'postgres'
        ? { ...profile, database: overrideDatabase }
        : profile
    return host.openConnection(eff)
  })
  ipcMain.handle('connection:close', async (_e, connectionId: string) => {
    const host = getHostControl()
    if (!host) throw new Error('db-host unavailable')
    return host.closeConnection(connectionId)
  })

  // Native open-file dialog for picking a SQLite database file.
  ipcMain.handle('dialog:open-file', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'SQLite', extensions: ['sqlite', 'db', 'sqlite3'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
}

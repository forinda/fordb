import { ipcMain, safeStorage, app, dialog } from 'electron'
import { join } from 'node:path'
import { writeFile, readFile } from 'node:fs/promises'
import { gzipSync, gunzipSync } from 'node:zlib'
import { ProfileStore } from './profile-store'
import { SecretStore, type SafeStorageLike } from './secret-store'
import { QueryLibraryStore } from './query-library-store'
import { SettingsStore } from './settings-store'
import { McpService } from './mcp/service'
import type { McpConnectionInfo } from './mcp/server'
import { checkForUpdates, quitAndInstall } from './updater'
import type { ConnectionProfile } from '@shared/adapter/types'
import type { HostApi } from '@shared/host/host-api'

export function registerIpc(getHostControl: () => HostApi | null): void {
  const dir = app.getPath('userData')
  const profiles = new ProfileStore(join(dir, 'profiles.json'))
  const secrets = new SecretStore(
    join(dir, 'secrets.json'),
    safeStorage as unknown as SafeStorageLike
  )
  const queryLibrary = new QueryLibraryStore(join(dir, 'query-library.json'))
  const settingsStore = new SettingsStore(join(dir, 'settings.json'))

  // connectionId -> profileId for currently-open connections. The MCP allowlist
  // is the subset whose profile opted in via `exposeToMcp`.
  const openConnections = new Map<string, string>()
  const exposedConnections = async (): Promise<McpConnectionInfo[]> => {
    const byId = new Map((await profiles.list()).map((p) => [p.id, p]))
    const out: McpConnectionInfo[] = []
    for (const [connectionId, profileId] of openConnections) {
      const p = byId.get(profileId)
      if (p?.exposeToMcp) out.push({ connectionId, name: p.name, engine: p.engine })
    }
    return out
  }
  const mcp = new McpService(settingsStore, secrets, getHostControl, exposedConnections)

  ipcMain.handle('mcp:status', () => mcp.status())
  ipcMain.handle('mcp:set-enabled', (_e, enabled: boolean) => mcp.setEnabled(enabled))
  ipcMain.handle('mcp:set-port', (_e, port: number) => mcp.setPort(port))
  ipcMain.handle('mcp:regenerate-token', () => mcp.regenerateToken())

  ipcMain.handle('updater:check', () => checkForUpdates())
  ipcMain.handle('updater:install', () => quitAndInstall())
  ipcMain.handle('queries:history-list', (_e, profileId: string) =>
    queryLibrary.listHistory(profileId)
  )
  ipcMain.handle('queries:history-add', (_e, profileId: string, sql: string) =>
    queryLibrary.addHistory(profileId, sql)
  )
  ipcMain.handle('queries:saved-list', (_e, profileId: string) => queryLibrary.listSaved(profileId))
  ipcMain.handle('queries:save', (_e, profileId: string, name: string, sql: string) =>
    queryLibrary.saveQuery(profileId, name, sql)
  )
  ipcMain.handle('queries:saved-delete', (_e, profileId: string, id: string) =>
    queryLibrary.deleteSaved(profileId, id)
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
        uri?: string
      }
    ) => {
      await profiles.save(profile)
      if (
        secretFields.password ||
        secretFields.sshPassword ||
        secretFields.sshPassphrase ||
        secretFields.authToken ||
        secretFields.uri
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
    if (profile.engine === 'mongodb') {
      const s = await secrets.get(id)
      return { ...profile, uri: s.uri, password: s.password }
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
    const connectionId = await host.openConnection(eff)
    openConnections.set(connectionId, profileId)
    return connectionId
  })
  ipcMain.handle('connection:close', async (_e, connectionId: string) => {
    const host = getHostControl()
    if (!host) throw new Error('db-host unavailable')
    openConnections.delete(connectionId)
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

  // Open a text file (import a .sql / .csv) and return its path + contents.
  ipcMain.handle('dialog:open-text', async (_e, exts: string[]) => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'File', extensions: exts },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    const path = r.filePaths[0]
    if (r.canceled || !path) return null
    // Transparently gunzip a .gz file (round-trips the "Export (SQL, gzip)" output).
    const buf = await readFile(path)
    const text = path.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8')
    return { name: path, text }
  })

  // Save an exported SQL dump to a user-chosen path (gzip in main).
  ipcMain.handle('export:save', async (_e, defaultName: string, text: string, gzip: boolean) => {
    const r = await dialog.showSaveDialog({
      defaultPath: gzip ? `${defaultName}.gz` : defaultName
    })
    if (r.canceled || !r.filePath) return false
    await writeFile(r.filePath, gzip ? gzipSync(Buffer.from(text, 'utf8')) : text)
    return true
  })

  // Start the MCP server now if the user left it enabled (off by default).
  void mcp.sync()
}

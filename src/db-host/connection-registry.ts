import { readFile } from 'node:fs/promises'
import type { DbAdapter } from '../shared/adapter/db-adapter'
import type { ConnectionProfile } from '../shared/adapter/types'
import type { ConnectionId } from '../shared/host/host-api'
import { openTunnel, type TunnelHandle } from './ssh-tunnel'

interface Entry {
  adapter: DbAdapter
  profile: ConnectionProfile
  tunnel?: TunnelHandle
}

export class ConnectionRegistry {
  private entries = new Map<ConnectionId, Entry>()

  constructor(
    private readonly makeAdapter: () => DbAdapter,
    private readonly nextId: () => ConnectionId
  ) {}

  async open(profile: ConnectionProfile): Promise<ConnectionId> {
    let tunnel: TunnelHandle | undefined
    let effective = profile
    if (profile.ssh) {
      const privateKey =
        profile.ssh.authMethod === 'key' && profile.ssh.privateKeyPath
          ? await readFile(profile.ssh.privateKeyPath)
          : undefined
      tunnel = await openTunnel(
        profile,
        profile.ssh.authMethod === 'password' ? profile.sshPassword : undefined,
        privateKey
      )
      effective = { ...profile, host: '127.0.0.1', port: tunnel.localPort }
    }
    const adapter = this.makeAdapter()
    try {
      await adapter.connect(effective)
    } catch (err) {
      await tunnel?.close()
      throw err
    }
    const id = this.nextId()
    this.entries.set(id, { adapter, profile, tunnel })
    return id
  }

  get(id: ConnectionId): DbAdapter {
    const entry = this.entries.get(id)
    if (!entry) throw new Error(`Unknown connection: ${id}`)
    return entry.adapter
  }

  async close(id: ConnectionId): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    await entry.adapter.disconnect()
    await entry.tunnel?.close()
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.close(id)))
  }
}

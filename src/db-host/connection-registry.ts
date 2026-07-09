import type { DbAdapter } from '@shared/adapter/db-adapter'
import type { ConnectionProfile } from '@shared/adapter/types'
import type { ConnectionId } from '@shared/host/host-api'
import { connectAdapter } from './connect-with-tunnel'
import type { TunnelHandle } from './ssh-tunnel'

interface Entry {
  adapter: DbAdapter
  profile: ConnectionProfile
  tunnel?: TunnelHandle
}

export class ConnectionRegistry {
  private entries = new Map<ConnectionId, Entry>()

  constructor(
    private readonly makeAdapter: (engine: ConnectionProfile['engine']) => DbAdapter,
    private readonly nextId: () => ConnectionId
  ) {}

  async open(profile: ConnectionProfile): Promise<ConnectionId> {
    const { adapter, tunnel } = await connectAdapter(this.makeAdapter, profile)
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
    try {
      await entry.adapter.disconnect()
    } finally {
      await entry.tunnel?.close()
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.close(id)))
  }
}

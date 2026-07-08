import type { DbAdapter } from '../shared/adapter/db-adapter'
import type { ConnectionProfile } from '../shared/adapter/types'
import type { ConnectionId } from '../shared/host/host-api'

interface Entry {
  adapter: DbAdapter
  profile: ConnectionProfile
}

export class ConnectionRegistry {
  private entries = new Map<ConnectionId, Entry>()

  constructor(
    private readonly makeAdapter: () => DbAdapter,
    private readonly nextId: () => ConnectionId
  ) {}

  async open(profile: ConnectionProfile): Promise<ConnectionId> {
    const adapter = this.makeAdapter()
    await adapter.connect(profile)
    const id = this.nextId()
    this.entries.set(id, { adapter, profile })
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
  }

  async closeAll(): Promise<void> {
    const ids = [...this.entries.keys()]
    await Promise.all(ids.map((id) => this.close(id)))
  }
}

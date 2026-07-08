import { readFile } from 'node:fs/promises'
import type { DbAdapter } from '../shared/adapter/db-adapter'
import type { ConnectionProfile } from '../shared/adapter/types'
import { openTunnel, type TunnelHandle } from './ssh-tunnel'

export interface ConnectedAdapter {
  adapter: DbAdapter
  tunnel?: TunnelHandle
}

/**
 * Opens an SSH tunnel (if profile.ssh is set) and connects an adapter through
 * it, or directly to profile.host/port when there's no ssh block. On adapter
 * connect failure, tears down the tunnel before rethrowing so callers never
 * leak a tunnel when the DB-side connect fails.
 */
export async function connectAdapter(
  makeAdapter: () => DbAdapter,
  profile: ConnectionProfile
): Promise<ConnectedAdapter> {
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
  // makeAdapter() inside the guard too: if it throws after a tunnel was
  // opened, the tunnel must still be torn down rather than leaked.
  let adapter: DbAdapter
  try {
    adapter = makeAdapter()
    await adapter.connect(effective)
  } catch (err) {
    await tunnel?.close()
    throw err
  }
  return { adapter, tunnel }
}

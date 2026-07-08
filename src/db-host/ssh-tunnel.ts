import { createTunnel } from 'tunnel-ssh'
import type { ConnectionProfile } from '@shared/adapter/types'

export interface TunnelConfig {
  ssh: {
    host: string
    port: number
    username: string
    password?: string
    privateKey?: Buffer
    passphrase?: string
    agent?: string
  }
  forward: { dstAddr: string; dstPort: number }
}

export interface TunnelHandle {
  localPort: number
  close: () => Promise<void>
}

export function buildTunnelConfig(
  profile: ConnectionProfile,
  sshPassword: string | undefined,
  privateKey: Buffer | undefined
): TunnelConfig {
  const ssh = profile.ssh
  if (!ssh) throw new Error('Profile has no ssh block')
  return {
    ssh: {
      host: ssh.host,
      port: ssh.port,
      username: ssh.user,
      password: ssh.authMethod === 'password' ? sshPassword : undefined,
      privateKey: ssh.authMethod === 'key' ? privateKey : undefined,
      passphrase: ssh.authMethod === 'key' ? profile.sshPassphrase : undefined,
      agent: ssh.authMethod === 'agent' ? process.env.SSH_AUTH_SOCK : undefined
    },
    forward: { dstAddr: profile.host, dstPort: profile.port }
  }
}

export async function openTunnel(
  profile: ConnectionProfile,
  sshPassword: string | undefined,
  privateKey: Buffer | undefined
): Promise<TunnelHandle> {
  const cfg = buildTunnelConfig(profile, sshPassword, privateKey)
  const [server] = await createTunnel(
    { autoClose: false, reconnectOnError: false },
    { host: '127.0.0.1', port: 0 }, // OS-assigned local port
    {
      host: cfg.ssh.host,
      port: cfg.ssh.port,
      username: cfg.ssh.username,
      password: cfg.ssh.password,
      privateKey: cfg.ssh.privateKey,
      passphrase: cfg.ssh.passphrase,
      agent: cfg.ssh.agent
    },
    { dstAddr: cfg.forward.dstAddr, dstPort: cfg.forward.dstPort }
  )
  const addr = server.address()
  if (typeof addr === 'string' || addr === null) throw new Error('Tunnel local port unavailable')
  return {
    localPort: addr.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

import { describe, it, expect } from 'vitest'
import { buildTunnelConfig } from '../../src/db-host/ssh-tunnel'
import type { ConnectionProfile } from '../../src/shared/adapter/types'

const profile: ConnectionProfile = {
  id: 'p1',
  name: 't',
  engine: 'postgres',
  host: 'db.internal',
  port: 5432,
  database: 'd',
  user: 'u',
  sshPassphrase: 'pp',
  ssh: { host: 'bastion', port: 22, user: 'ops', authMethod: 'password' }
}

describe('buildTunnelConfig', () => {
  it('forwards to the DB host/port from the profile', () => {
    const cfg = buildTunnelConfig({ ...profile, password: undefined }, 'sshpw', undefined)
    expect(cfg.forward.dstAddr).toBe('db.internal')
    expect(cfg.forward.dstPort).toBe(5432)
    expect(cfg.ssh.host).toBe('bastion')
    expect(cfg.ssh.username).toBe('ops')
  })
  it('uses password auth when authMethod is password', () => {
    const cfg = buildTunnelConfig(profile, 'sshpw', undefined)
    expect(cfg.ssh.password).toBe('sshpw')
    expect(cfg.ssh.privateKey).toBeUndefined()
  })
  it('uses privateKey + passphrase when authMethod is key', () => {
    const p = {
      ...profile,
      ssh: { ...profile.ssh!, authMethod: 'key' as const, privateKeyPath: '/k' }
    }
    const cfg = buildTunnelConfig(p, undefined, Buffer.from('KEY'))
    expect(cfg.ssh.privateKey?.toString()).toBe('KEY')
    expect(cfg.ssh.passphrase).toBe('pp')
  })
  it('throws when profile has no ssh block', () => {
    expect(() => buildTunnelConfig({ ...profile, ssh: undefined }, undefined, undefined)).toThrow(
      /no ssh/i
    )
  })
})

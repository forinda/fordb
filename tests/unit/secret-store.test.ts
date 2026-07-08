import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretStore, type SafeStorageLike } from '../../src/main/secret-store'

// Reversible fake: base64, stands in for the OS keychain in headless tests.
const fakeCrypto: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s, 'utf8').toString('base64') as unknown as Buffer,
  decryptString: (b) => Buffer.from(String(b), 'base64').toString('utf8')
}

let store: SecretStore
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'fordb-sec-'))
  store = new SecretStore(join(dir, 'secrets.json'), fakeCrypto)
})

describe('SecretStore', () => {
  it('round-trips a password', async () => {
    await store.set('p1', { password: 'hunter2' })
    expect(await store.get('p1')).toEqual({ password: 'hunter2' })
  })
  it('round-trips password and ssh secrets together', async () => {
    await store.set('p1', {
      password: 'hunter2',
      sshPassword: 'sshpw',
      sshPassphrase: 'passphrase'
    })
    expect(await store.get('p1')).toEqual({
      password: 'hunter2',
      sshPassword: 'sshpw',
      sshPassphrase: 'passphrase'
    })
  })
  it('returns empty object for unknown id', async () => {
    expect(await store.get('nope')).toEqual({})
  })
  it('delete removes secrets', async () => {
    await store.set('p1', { password: 'x', sshPassphrase: 'y' })
    await store.delete('p1')
    expect(await store.get('p1')).toEqual({})
  })
  it('throws when encryption unavailable', async () => {
    const bad = new SecretStore('/tmp/x', { ...fakeCrypto, isEncryptionAvailable: () => false })
    await expect(bad.set('p1', { password: 'x' })).rejects.toThrow(/keychain|encryption/i)
  })
})

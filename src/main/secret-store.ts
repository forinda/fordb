import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface StoredSecrets {
  password?: string
  sshPassword?: string
  sshPassphrase?: string
  authToken?: string
}

/** On-disk shape: id → base64 of the encrypted JSON of StoredSecrets. */
type SecretsFile = Record<string, string>

export class SecretStore {
  constructor(
    private readonly filePath: string,
    private readonly crypto: SafeStorageLike
  ) {}

  private async readAll(): Promise<SecretsFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as SecretsFile
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw err
    }
  }

  private async writeAll(data: SecretsFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(data), 'utf8')
  }

  async set(id: string, secrets: StoredSecrets): Promise<void> {
    if (!this.crypto.isEncryptionAvailable()) {
      throw new Error('OS keychain encryption unavailable; refusing to store secret in plaintext')
    }
    const all = await this.readAll()
    const enc = this.crypto.encryptString(JSON.stringify(secrets))
    all[id] = Buffer.from(enc).toString('base64')
    await this.writeAll(all)
  }

  async get(id: string): Promise<StoredSecrets> {
    const all = await this.readAll()
    const blob = all[id]
    if (!blob) return {}
    const dec = this.crypto.decryptString(Buffer.from(blob, 'base64'))
    return JSON.parse(dec) as StoredSecrets
  }

  async delete(id: string): Promise<void> {
    const all = await this.readAll()
    delete all[id]
    await this.writeAll(all)
  }
}

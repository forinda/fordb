export interface SslOptions {
  ca?: string
  cert?: string
  key?: string
  rejectUnauthorized: boolean
}

export interface SshOptions {
  host: string
  port: number
  user: string
  authMethod: 'password' | 'key' | 'agent'
  /** Path to a private key file; used when authMethod === 'key'. */
  privateKeyPath?: string
}

interface BaseProfile {
  id: string
  name: string
  /** Optional non-secret metadata (Dialect connections manager). */
  environment?: 'production' | 'staging' | 'local'
  favorite?: boolean
}

export interface PostgresProfile extends BaseProfile {
  engine: 'postgres'
  host: string
  port: number
  database: string
  user: string
  // SECRETS — transient, injected at connect time, NEVER persisted. Any new
  // secret field added here MUST also be stripped in ProfileStore.save()
  // (src/main/profile-store.ts). See M2 final-review note on nesting these
  // under a single `secrets?` key to make omission structural, not enumerated.
  password?: string
  sshPassword?: string
  sshPassphrase?: string
  ssl?: SslOptions
  ssh?: SshOptions
}

interface SqliteBase extends BaseProfile {
  engine: 'sqlite'
}

/** A local .sqlite/.db file — secretless. */
export interface SqliteLocal extends SqliteBase {
  kind: 'local'
  file: string
}

/** A remote libsql/Turso database. `authToken` is a SECRET (keychain, never persisted). */
export interface SqliteRemote extends SqliteBase {
  kind: 'remote'
  url: string
  authToken?: string
}

/** An embedded replica: a local file synced from a remote. `authToken` SECRET. */
export interface SqliteReplica extends SqliteBase {
  kind: 'replica'
  file: string
  syncUrl: string
  authToken?: string
}

export type SqliteProfile = SqliteLocal | SqliteRemote | SqliteReplica

export interface MongoProfile extends BaseProfile {
  engine: 'mongodb'
  // URI path (primary) — whole connection string incl. credentials. SECRET.
  uri?: string
  // Discrete path (used only when uri is absent).
  host?: string
  port?: number
  user?: string
  password?: string // SECRET
  authSource?: string
  tls?: boolean
  // Default database (from the URI path, or explicit for the discrete path).
  database?: string
}

/** A saved connection. Discriminated on `engine`; consumers narrow before
 *  reading engine-specific fields (the union is the compile-time safety net). */
export type ConnectionProfile = PostgresProfile | SqliteProfile | MongoProfile

export interface TableInfo {
  schema: string
  name: string
  type: 'table' | 'view'
}

export interface ColumnInfo {
  name: string
  dataType: string
  nullable: boolean
  defaultValue: string | null
  ordinal: number
}

export interface KeyInfo {
  name: string
  kind: 'primary' | 'foreign' | 'unique'
  columns: string[]
  referencedTable: string | null
  referencedColumns: string[] | null // FK target columns (null for pk/unique)
}

export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
}

export interface FieldInfo {
  name: string
  dataType: string
}

export interface QueryResult {
  fields: FieldInfo[]
  rows: unknown[][]
  rowCount: number
  command: string
}

export interface OpenQueryResult {
  queryId: string
  fields: FieldInfo[]
}

export interface Page {
  rows: unknown[][]
  done: boolean
}

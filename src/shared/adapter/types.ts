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

export interface ConnectionProfile {
  id: string
  name: string
  engine: 'postgres'
  host: string
  port: number
  database: string
  user: string
  password?: string
  sshPassword?: string
  sshPassphrase?: string
  ssl?: SslOptions
  ssh?: SshOptions
}

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

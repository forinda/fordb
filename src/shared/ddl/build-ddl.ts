import type { ColumnInfo, IndexInfo, KeyInfo } from '../adapter/types'
import type {
  ColumnSpec,
  DdlChange,
  ForeignKeySpec,
  IndexSpec,
  TableSpec
} from '../adapter/schema-types'
import { quoteIdent } from '../mutation/build-edits'

type Dialect = 'pg' | 'sqlite'

const qi = quoteIdent
// Postgres qualifies objects as schema.table. SQLite is single-db here (main/
// attached) and both libsql's parser and CREATE INDEX's `ON table` reject a
// schema-qualified name, so emit bare, unqualified identifiers for sqlite.
const qtable = (schema: string, table: string, dialect: Dialect): string =>
  dialect === 'sqlite' ? qi(table) : `${qi(schema)}.${qi(table)}`

function columnClause(c: ColumnSpec): string {
  // type and DEFAULT are raw SQL text by design (a type/default IS a SQL
  // fragment); this path is preview+confirm gated, never a bound-value path.
  let s = `${qi(c.name)} ${c.type}`
  if (c.notNull) s += ' NOT NULL'
  if (c.default != null) s += ` DEFAULT ${c.default}`
  return s
}

function createTable(spec: TableSpec, dialect: Dialect): string {
  const lines = spec.columns.map(columnClause)
  if (spec.primaryKey && spec.primaryKey.length)
    lines.push(`PRIMARY KEY (${spec.primaryKey.map(qi).join(', ')})`)
  return `CREATE TABLE ${qtable(spec.schema, spec.table, dialect)} (\n  ${lines.join(',\n  ')}\n)`
}

function createIndex(spec: IndexSpec, dialect: Dialect): string {
  const u = spec.unique ? 'UNIQUE ' : ''
  return `CREATE ${u}INDEX ${qi(spec.name)} ON ${qtable(spec.schema, spec.table, dialect)} (${spec.columns
    .map(qi)
    .join(', ')})`
}

function addForeignKey(spec: ForeignKeySpec, dialect: Dialect): string {
  return (
    `ALTER TABLE ${qtable(spec.schema, spec.table, dialect)} ADD CONSTRAINT ${qi(spec.name)} ` +
    `FOREIGN KEY (${spec.columns.map(qi).join(', ')}) ` +
    `REFERENCES ${qtable(spec.refSchema, spec.refTable, dialect)} (${spec.refColumns.map(qi).join(', ')})`
  )
}

export function buildDdl(change: DdlChange, dialect: Dialect): string[] {
  switch (change.kind) {
    case 'createTable':
      return [createTable(change.spec, dialect)]
    case 'addColumn':
      return [
        `ALTER TABLE ${qtable(change.schema, change.table, dialect)} ADD COLUMN ${columnClause(change.column)}`
      ]
    case 'createIndex':
      return [createIndex(change.spec, dialect)]
    case 'dropIndex':
      // SQLite indexes live in the (single) schema namespace; a qualifier errors.
      return [
        dialect === 'sqlite'
          ? `DROP INDEX ${qi(change.name)}`
          : `DROP INDEX ${qtable(change.schema, change.name, dialect)}`
      ]
    case 'addForeignKey':
      return [addForeignKey(change.spec, dialect)]
    case 'dropForeignKey':
      return [
        `ALTER TABLE ${qtable(change.schema, change.table, dialect)} DROP CONSTRAINT ${qi(change.name)}`
      ]
    case 'dropTable':
      return [`DROP TABLE ${qtable(change.schema, change.table, dialect)}`]
    case 'createSchema':
      return [`CREATE SCHEMA ${qi(change.name)}`]
    case 'dropSchema':
      return [`DROP SCHEMA ${qi(change.name)}`]
    case 'createDatabase':
      return [`CREATE DATABASE ${qi(change.name)}`]
    case 'dropDatabase':
      return [`DROP DATABASE ${qi(change.name)}`]
  }
}

export function reconstructDdl(
  cols: ColumnInfo[],
  keys: KeyInfo[],
  indexes: IndexInfo[],
  schema: string,
  table: string,
  dialect: Dialect
): string {
  const pk = keys.find((k) => k.kind === 'primary')
  const create = createTable(
    {
      schema,
      table,
      columns: cols
        .slice()
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((c) => ({
          name: c.name,
          type: c.dataType,
          notNull: !c.nullable,
          default: c.defaultValue
        })),
      primaryKey: pk?.columns
    },
    dialect
  )
  const idxLines = indexes
    // The PK's backing index is implied by PRIMARY KEY (…); don't re-emit it.
    .filter((i) => !(pk && i.columns.join(',') === pk.columns.join(',') && i.unique))
    .map((i) =>
      createIndex({ schema, table, name: i.name, columns: i.columns, unique: i.unique }, dialect)
    )
  return [create + ';', ...idxLines.map((l) => l + ';')].join('\n')
}

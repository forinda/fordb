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
// Both engines qualify objects as schema.table so DDL targets the right schema
// (SQLite genuinely has multiple: main, temp, ATTACHed). The one exception is
// CREATE INDEX (see createIndex): SQLite rejects a schema-qualified ON-table and
// instead qualifies the index name.
const qtable = (schema: string, table: string): string => `${qi(schema)}.${qi(table)}`

function columnClause(c: ColumnSpec): string {
  // type and DEFAULT are raw SQL text by design (a type/default IS a SQL
  // fragment); this path is preview+confirm gated, never a bound-value path.
  let s = `${qi(c.name)} ${c.type}`
  if (c.notNull) s += ' NOT NULL'
  if (c.default != null) s += ` DEFAULT ${c.default}`
  return s
}

function createTable(spec: TableSpec): string {
  const lines = spec.columns.map(columnClause)
  if (spec.primaryKey && spec.primaryKey.length)
    lines.push(`PRIMARY KEY (${spec.primaryKey.map(qi).join(', ')})`)
  return `CREATE TABLE ${qtable(spec.schema, spec.table)} (\n  ${lines.join(',\n  ')}\n)`
}

function createIndex(spec: IndexSpec, dialect: Dialect): string {
  const u = spec.unique ? 'UNIQUE ' : ''
  const cols = spec.columns.map(qi).join(', ')
  // SQLite: the schema qualifies the INDEX NAME and the ON-table must be bare
  // (a qualified ON-table is a syntax error). Postgres: bare index name, the
  // index lands in the ON-table's schema, so qualify the table.
  return dialect === 'sqlite'
    ? `CREATE ${u}INDEX ${qtable(spec.schema, spec.name)} ON ${qi(spec.table)} (${cols})`
    : `CREATE ${u}INDEX ${qi(spec.name)} ON ${qtable(spec.schema, spec.table)} (${cols})`
}

function addForeignKey(spec: ForeignKeySpec): string {
  return (
    `ALTER TABLE ${qtable(spec.schema, spec.table)} ADD CONSTRAINT ${qi(spec.name)} ` +
    `FOREIGN KEY (${spec.columns.map(qi).join(', ')}) ` +
    `REFERENCES ${qtable(spec.refSchema, spec.refTable)} (${spec.refColumns.map(qi).join(', ')})`
  )
}

export function buildDdl(change: DdlChange, dialect: Dialect): string[] {
  switch (change.kind) {
    case 'createTable':
      return [createTable(change.spec)]
    case 'addColumn':
      return [
        `ALTER TABLE ${qtable(change.schema, change.table)} ADD COLUMN ${columnClause(change.column)}`
      ]
    case 'createIndex':
      return [createIndex(change.spec, dialect)]
    case 'dropIndex':
      // Both engines accept a schema-qualified index name here.
      return [`DROP INDEX ${qtable(change.schema, change.name)}`]
    case 'addForeignKey':
      return [addForeignKey(change.spec)]
    case 'dropForeignKey':
      return [
        `ALTER TABLE ${qtable(change.schema, change.table)} DROP CONSTRAINT ${qi(change.name)}`
      ]
    case 'dropTable':
      return [`DROP TABLE ${qtable(change.schema, change.table)}`]
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
  const create = createTable({
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
  })
  const idxLines = indexes
    // The PK's backing index is implied by PRIMARY KEY (…); don't re-emit it.
    .filter((i) => !(pk && i.columns.join(',') === pk.columns.join(',') && i.unique))
    .map((i) =>
      createIndex({ schema, table, name: i.name, columns: i.columns, unique: i.unique }, dialect)
    )
  return [create + ';', ...idxLines.map((l) => l + ';')].join('\n')
}

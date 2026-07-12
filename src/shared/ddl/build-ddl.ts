import type { ColumnInfo, IndexInfo, KeyInfo } from '../adapter/types'
import type {
  ColumnSpec,
  CreateDatabaseOptions,
  DdlChange,
  ForeignKeySpec,
  IndexSpec,
  TableSpec,
  TableStructure
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
  if (c.unique) s += ' UNIQUE'
  return s
}

function createTable(spec: TableSpec): string {
  const lines = spec.columns.map(columnClause)
  if (spec.primaryKey && spec.primaryKey.length)
    lines.push(`PRIMARY KEY (${spec.primaryKey.map(qi).join(', ')})`)
  for (const fk of spec.foreignKeys ?? []) {
    // SQLite forbids a cross-schema ref in a table body, so a missing refSchema
    // yields a bare ref table; Postgres qualifies when refSchema is present.
    const ref = fk.refSchema ? qtable(fk.refSchema, fk.refTable) : qi(fk.refTable)
    lines.push(
      `CONSTRAINT ${qi(fk.name)} FOREIGN KEY (${fk.columns.map(qi).join(', ')}) ` +
        `REFERENCES ${ref} (${fk.refColumns.map(qi).join(', ')})`
    )
  }
  for (const chk of spec.checks ?? [])
    lines.push(`CONSTRAINT ${qi(chk.name)} CHECK (${chk.expression})`)
  return `CREATE TABLE ${qtable(spec.schema, spec.table)} (\n  ${lines.join(',\n  ')}\n)`
}

function sqlStr(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}
function createDatabase(name: string, o?: CreateDatabaseOptions): string {
  let s = `CREATE DATABASE ${qi(name)}`
  if (!o) return s
  if (o.owner) s += ` OWNER ${qi(o.owner)}`
  if (o.encoding) s += ` ENCODING ${sqlStr(o.encoding)}`
  if (o.template) s += ` TEMPLATE ${qi(o.template)}`
  if (o.lcCollate) s += ` LC_COLLATE ${sqlStr(o.lcCollate)}`
  if (o.lcCtype) s += ` LC_CTYPE ${sqlStr(o.lcCtype)}`
  if (o.tablespace) s += ` TABLESPACE ${qi(o.tablespace)}`
  if (o.connectionLimit != null) s += ` CONNECTION LIMIT ${o.connectionLimit}`
  return s
}

function createIndex(spec: IndexSpec, dialect: Dialect): string {
  const u = spec.unique ? 'UNIQUE ' : ''
  // Expression index (raw) or a quoted column list.
  const target = spec.expression ? `(${spec.expression})` : `(${spec.columns.map(qi).join(', ')})`
  // SQLite: the schema qualifies the INDEX NAME and the ON-table must be bare
  // (a qualified ON-table is a syntax error). Postgres: bare index name, the
  // index lands in the ON-table's schema, so qualify the table.
  const head =
    dialect === 'sqlite'
      ? `CREATE ${u}INDEX ${qtable(spec.schema, spec.name)} ON ${qi(spec.table)} ${target}`
      : `CREATE ${u}INDEX ${qi(spec.name)} ON ${qtable(spec.schema, spec.table)} ${target}`
  return spec.where ? `${head} WHERE (${spec.where})` : head
}

function addForeignKey(spec: ForeignKeySpec): string {
  return (
    `ALTER TABLE ${qtable(spec.schema, spec.table)} ADD CONSTRAINT ${qi(spec.name)} ` +
    `FOREIGN KEY (${spec.columns.map(qi).join(', ')}) ` +
    `REFERENCES ${qtable(spec.refSchema, spec.refTable)} (${spec.refColumns.map(qi).join(', ')})`
  )
}

// Postgres alters a column in place: one statement per changed field, in a
// stable order (type → default → notNull).
function pgAlterColumn(change: Extract<DdlChange, { kind: 'alterColumn' }>): string[] {
  const t = qtable(change.schema, change.table)
  const col = qi(change.column)
  const out: string[] = []
  if (change.type !== undefined)
    out.push(`ALTER TABLE ${t} ALTER COLUMN ${col} TYPE ${change.type}`)
  if (change.default !== undefined)
    out.push(
      change.default === null
        ? `ALTER TABLE ${t} ALTER COLUMN ${col} DROP DEFAULT`
        : `ALTER TABLE ${t} ALTER COLUMN ${col} SET DEFAULT ${change.default}`
    )
  if (change.notNull !== undefined)
    out.push(
      change.notNull
        ? `ALTER TABLE ${t} ALTER COLUMN ${col} SET NOT NULL`
        : `ALTER TABLE ${t} ALTER COLUMN ${col} DROP NOT NULL`
    )
  return out
}

interface Fk {
  name: string
  columns: string[]
  refTable: string
  refColumns: string[]
}

// The SQLite 12-step table rebuild (SQLite can't alter a column in place).
// Verified atomic inside batch('write') with defer_foreign_keys first.
function buildSqliteRebuild(
  ctx: TableStructure,
  schema: string,
  table: string,
  mutate: { columns: ColumnSpec[]; fks: Fk[] }
): string[] {
  const tmp = `${table}__fordb_rebuild`
  const colDefs = mutate.columns.map(columnClause)
  const pk = ctx.keys.find((k) => k.kind === 'primary')
  if (pk && pk.columns.length) colDefs.push(`PRIMARY KEY (${pk.columns.map(qi).join(', ')})`)
  // Re-declare UNIQUE constraints as table constraints. SQLite backs each with an
  // internal `sqlite_autoindex_*` index whose name is reserved — it CANNOT be
  // recreated via CREATE INDEX, so it is skipped below and the constraint is
  // carried here instead (which recreates the same enforcement + auto-index).
  for (const u of ctx.keys.filter((k) => k.kind === 'unique'))
    colDefs.push(`UNIQUE (${u.columns.map(qi).join(', ')})`)
  for (const fk of mutate.fks)
    colDefs.push(
      `FOREIGN KEY (${fk.columns.map(qi).join(', ')}) REFERENCES ${qi(fk.refTable)} (${fk.refColumns
        .map(qi)
        .join(', ')})`
    )
  // Carried columns = new columns that also exist in the old table.
  const oldNames = new Set(ctx.columns.map((c) => c.name))
  const carried = mutate.columns
    .filter((c) => oldNames.has(c.name))
    .map((c) => qi(c.name))
    .join(', ')
  const idxLines = ctx.indexes
    // Skip SQLite's auto-created constraint indexes (PK/UNIQUE) — reserved names,
    // recreated implicitly by the PRIMARY KEY / UNIQUE clauses above.
    .filter((i) => !i.name.startsWith('sqlite_autoindex_'))
    .map((i) =>
      createIndex({ schema, table, name: i.name, columns: i.columns, unique: i.unique }, 'sqlite')
    )
  return [
    `PRAGMA defer_foreign_keys=ON`,
    `CREATE TABLE ${qtable(schema, tmp)} (\n  ${colDefs.join(',\n  ')}\n)`,
    `INSERT INTO ${qtable(schema, tmp)} (${carried}) SELECT ${carried} FROM ${qtable(schema, table)}`,
    `DROP TABLE ${qtable(schema, table)}`,
    `ALTER TABLE ${qtable(schema, tmp)} RENAME TO ${qi(table)}`,
    ...idxLines
  ]
}

function currentColumns(ctx: TableStructure): ColumnSpec[] {
  return ctx.columns
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((c) => ({ name: c.name, type: c.dataType, notNull: !c.nullable, default: c.defaultValue }))
}
function currentFks(ctx: TableStructure): Fk[] {
  return ctx.keys
    .filter((k) => k.kind === 'foreign' && k.referencedTable && k.referencedColumns)
    .map((k) => ({
      name: k.name,
      columns: k.columns,
      refTable: k.referencedTable!,
      refColumns: k.referencedColumns!
    }))
}

export function buildDdl(change: DdlChange, dialect: Dialect, context?: TableStructure): string[] {
  switch (change.kind) {
    case 'createTable':
      return [createTable(change.spec)]
    case 'addColumn':
      return [
        `ALTER TABLE ${qtable(change.schema, change.table)} ADD COLUMN ${columnClause(change.column)}`
      ]
    case 'renameColumn':
      // Native on both engines.
      return [
        `ALTER TABLE ${qtable(change.schema, change.table)} RENAME COLUMN ${qi(change.from)} TO ${qi(change.to)}`
      ]
    case 'dropColumn':
      // Native on both engines (SQLite >= 3.35 / libsql).
      return [`ALTER TABLE ${qtable(change.schema, change.table)} DROP COLUMN ${qi(change.column)}`]
    case 'alterColumn': {
      if (dialect === 'pg') return pgAlterColumn(change)
      if (!context) throw new Error('SQLite alterColumn requires a TableStructure context')
      const columns = currentColumns(context).map((c) =>
        c.name === change.column
          ? {
              ...c,
              ...(change.type !== undefined ? { type: change.type } : {}),
              ...(change.notNull !== undefined ? { notNull: change.notNull } : {}),
              ...(change.default !== undefined ? { default: change.default } : {})
            }
          : c
      )
      return buildSqliteRebuild(context, change.schema, change.table, {
        columns,
        fks: currentFks(context)
      })
    }
    case 'createIndex':
      return [createIndex(change.spec, dialect)]
    case 'dropIndex':
      // Both engines accept a schema-qualified index name here.
      return [`DROP INDEX ${qtable(change.schema, change.name)}`]
    case 'addCheck':
      // ALTER TABLE ADD/DROP CONSTRAINT is Postgres; SQLite can't alter a check
      // in place, so the UI only offers this on Postgres.
      return [
        `ALTER TABLE ${qtable(change.schema, change.table)} ADD CONSTRAINT ${qi(change.name)} CHECK (${change.expression})`
      ]
    case 'dropCheck':
      return [
        `ALTER TABLE ${qtable(change.schema, change.table)} DROP CONSTRAINT ${qi(change.name)}`
      ]
    case 'addForeignKey':
      if (dialect === 'pg') return [addForeignKey(change.spec)]
      if (!context) throw new Error('SQLite addForeignKey requires a TableStructure context')
      return buildSqliteRebuild(context, change.spec.schema, change.spec.table, {
        columns: currentColumns(context),
        fks: [
          ...currentFks(context),
          {
            name: change.spec.name,
            columns: change.spec.columns,
            refTable: change.spec.refTable,
            refColumns: change.spec.refColumns
          }
        ]
      })
    case 'dropForeignKey':
      if (dialect === 'pg')
        return [
          `ALTER TABLE ${qtable(change.schema, change.table)} DROP CONSTRAINT ${qi(change.name)}`
        ]
      // change.name is the synthetic FK name from getKeys (fk_N).
      if (!context) throw new Error('SQLite dropForeignKey requires a TableStructure context')
      return buildSqliteRebuild(context, change.schema, change.table, {
        columns: currentColumns(context),
        fks: currentFks(context).filter((f) => f.name !== change.name)
      })
    case 'dropTable':
      return [`DROP TABLE ${qtable(change.schema, change.table)}`]
    case 'createSchema':
      return [`CREATE SCHEMA ${qi(change.name)}`]
    case 'dropSchema':
      return [`DROP SCHEMA ${qi(change.name)}`]
    case 'createDatabase':
      return [createDatabase(change.name, change.options)]
    case 'dropDatabase':
      return [`DROP DATABASE ${qi(change.name)}`]
    case 'createView': {
      // OR REPLACE only on PG; the SELECT body is raw user SQL (preview-gated).
      const or = change.orReplace && dialect === 'pg' ? 'OR REPLACE ' : ''
      return [`CREATE ${or}VIEW ${qtable(change.schema, change.name)} AS ${change.select}`]
    }
    case 'dropView':
      return [`DROP VIEW ${qtable(change.schema, change.name)}`]
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

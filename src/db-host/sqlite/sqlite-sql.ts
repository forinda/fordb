// SQLite PRAGMA and attached-schema references don't accept bind parameters, so
// identifiers (schema/table/index) are interpolated. They are quoted AND their
// embedded double-quotes doubled — the standard SQL identifier escape — so a
// hostile object name (e.g. a table literally called `foo"bar` in an untrusted
// .sqlite file) can't break out of the quotes or inject SQL. `listTables` in
// particular is a full SELECT, not a restricted PRAGMA grammar, so escaping is
// load-bearing there.
function q(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

export const DATABASE_LIST = `PRAGMA database_list`

export const listTables = (schema: string): string =>
  `SELECT name, type FROM ${q(schema)}.sqlite_master
   WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`

export const tableInfo = (schema: string, table: string): string =>
  `PRAGMA ${q(schema)}.table_info(${q(table)})`

export const foreignKeyList = (schema: string, table: string): string =>
  `PRAGMA ${q(schema)}.foreign_key_list(${q(table)})`

export const indexList = (schema: string, table: string): string =>
  `PRAGMA ${q(schema)}.index_list(${q(table)})`

export const indexInfo = (schema: string, index: string): string =>
  `PRAGMA ${q(schema)}.index_info(${q(index)})`

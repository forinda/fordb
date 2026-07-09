// Identifiers (schema/table/index) are quoted and interpolated because SQLite
// PRAGMA and attached-schema references don't accept bind parameters. Only
// names sourced from the catalog (listSchemas/listTables) are ever passed.
export const DATABASE_LIST = `PRAGMA database_list`

export const listTables = (schema: string): string =>
  `SELECT name, type FROM "${schema}".sqlite_master
   WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`

export const tableInfo = (schema: string, table: string): string =>
  `PRAGMA "${schema}".table_info("${table}")`

export const foreignKeyList = (schema: string, table: string): string =>
  `PRAGMA "${schema}".foreign_key_list("${table}")`

export const indexList = (schema: string, table: string): string =>
  `PRAGMA "${schema}".index_list("${table}")`

export const indexInfo = (schema: string, index: string): string =>
  `PRAGMA "${schema}".index_info("${index}")`

import { quoteIdent } from '../mutation/build-edits'
import { renderSqlLiteral } from './literal'

/** One INSERT for a dumped row — identifiers quoted, values escaped literals. */
export function buildInsert(
  schema: string,
  table: string,
  columns: string[],
  row: unknown[],
  dialect: 'pg' | 'sqlite'
): string {
  const cols = columns.map(quoteIdent).join(', ')
  const vals = row.map((v) => renderSqlLiteral(v, dialect)).join(', ')
  return `INSERT INTO ${quoteIdent(schema)}.${quoteIdent(table)} (${cols}) VALUES (${vals})`
}

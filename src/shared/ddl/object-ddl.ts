import type { ObjectKind } from '../adapter/object-types'
import { quoteIdent } from '../mutation/build-edits'

const qi = quoteIdent

/** Build a DROP for a view/function/trigger. Triggers need the table they're on,
 *  which isn't in the object name — parse it from the trigger's definition
 *  (`CREATE TRIGGER … ON <table> …`). Falls back to a `<table>` placeholder the
 *  user can fix if the definition can't be parsed. */
export function buildDropObject(
  kind: ObjectKind,
  schema: string,
  name: string,
  definition?: string
): string {
  if (kind === 'view') return `DROP VIEW ${qi(schema)}.${qi(name)}`
  if (kind === 'function') return `DROP FUNCTION ${qi(schema)}.${qi(name)}`
  // trigger — `... ON <table> ...`; the table may be schema-qualified and/or quoted.
  const m = definition?.match(/\bON\s+((?:"[^"]+"|[^\s".]+)(?:\.(?:"[^"]+"|[^\s".]+))?)/i)
  const table = m ? m[1] : `${qi(schema)}.<table>`
  return `DROP TRIGGER ${qi(name)} ON ${table}`
}

export function functionTemplate(schema: string): string {
  return `CREATE OR REPLACE FUNCTION ${qi(schema)}.new_function()
RETURNS void AS $$
BEGIN
  -- function body
END;
$$ LANGUAGE plpgsql`
}

export function triggerTemplate(schema: string): string {
  return `CREATE TRIGGER new_trigger
BEFORE INSERT ON ${qi(schema)}.some_table
FOR EACH ROW
EXECUTE FUNCTION ${qi(schema)}.some_function()`
}

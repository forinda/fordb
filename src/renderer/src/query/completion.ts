import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete'
import { queryClient } from './client'
import { fetchSchemas, fetchTables, fetchColumns } from './introspection'
import { parseFromTables, resolveTable } from '@shared/sql/scope'

// Completes: `alias.`/`table.` → that table's columns (aliases resolved from the
// statement's FROM/JOIN clauses); bare word → schema + table names + columns of
// the in-scope FROM tables. Uses the shared React Query cache, so it dedups with
// the schema tree.
export function schemaCompletionSource(connId: string) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    try {
      const doc = ctx.state.doc.toString()
      const from = parseFromTables(doc)

      // `prefix.` — complete columns of the resolved table.
      const dotted = ctx.matchBefore(/([A-Za-z_]\w*)\.\w*/)
      if (dotted) {
        const prefix = dotted.text.split('.')[0]!
        const table = resolveTable(prefix, from)
        const cols = await columnsOf(connId, table)
        if (!cols) return null
        return { from: dotted.from + prefix.length + 1, options: cols }
      }

      // Bare word → schemas + tables + in-scope columns.
      const word = ctx.matchBefore(/\w+/)
      if (!word || (word.from === word.to && !ctx.explicit)) return null

      const schemas = await fetchSchemas(queryClient, connId)
      const options: Completion[] = schemas.map((s) => ({ label: s, type: 'namespace' }))
      for (const schema of schemas) {
        const tables = await fetchTables(queryClient, connId, schema)
        for (const t of tables)
          options.push({
            label: t.name,
            type: 'class',
            ...(t.type === 'view' ? { detail: 'view' } : {})
          })
      }
      // Columns of the in-scope FROM tables (de-duped by label).
      const seen = new Set<string>()
      for (const f of from) {
        const cols = await columnsOf(connId, f.table)
        for (const c of cols ?? []) {
          if (seen.has(c.label)) continue
          seen.add(c.label)
          options.push(c)
        }
      }
      return { from: word.from, options }
    } catch {
      return null
    }
  }
}

/** Columns of a table found across any schema, as completion options
 *  (label + type detail). null if the table isn't found in any schema. */
async function columnsOf(connId: string, table: string): Promise<Completion[] | null> {
  const schemas = await fetchSchemas(queryClient, connId)
  for (const schema of schemas) {
    const tables = await fetchTables(queryClient, connId, schema)
    if (tables.some((t) => t.name === table)) {
      const cols = await fetchColumns(queryClient, connId, schema, table)
      return cols.map((c) => ({ label: c.name, type: 'property', detail: c.dataType }))
    }
  }
  return null
}

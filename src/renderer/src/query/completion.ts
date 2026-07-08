import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete'
import { queryClient } from './client'
import { fetchSchemas, fetchTables, fetchColumns } from './introspection'

// Completes: bare identifiers → schema/table names; `table.` → that table's
// columns (looked up across schemas). Uses the shared React Query cache, so it
// dedups with the schema tree. Alias resolution is out of scope (deferred).
export function schemaCompletionSource(connId: string) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    // `word.` — complete columns of `word` (a table name in any schema).
    const dotted = ctx.matchBefore(/([A-Za-z_][\w]*)\.\w*/)
    if (dotted) {
      const table = dotted.text.split('.')[0]!
      const schemas = await fetchSchemas(queryClient, connId)
      for (const schema of schemas) {
        const tables = await fetchTables(queryClient, connId, schema)
        if (tables.some((t) => t.name === table)) {
          const cols = await fetchColumns(queryClient, connId, schema, table)
          const options: Completion[] = cols.map((c) => ({ label: c.name, type: 'property' }))
          return { from: dotted.from + table.length + 1, options }
        }
      }
      return null
    }
    // Bare word → schema + table names.
    const word = ctx.matchBefore(/[\w]+/)
    if (!word || (word.from === word.to && !ctx.explicit)) return null
    const schemas = await fetchSchemas(queryClient, connId)
    const options: Completion[] = schemas.map((s) => ({ label: s, type: 'namespace' }))
    for (const schema of schemas) {
      const tables = await fetchTables(queryClient, connId, schema)
      for (const t of tables) options.push({ label: t.name, type: 'class' })
    }
    return { from: word.from, options }
  }
}

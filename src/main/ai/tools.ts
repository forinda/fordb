// src/main/ai/tools.ts
import type { HostApi } from '@shared/host/host-api'
import { isReadOnlyQuery } from '@shared/sql/classify'
import { MCP_MAX_ROWS } from '../mcp/server'
import type { ToolCall, ToolSpec } from './openai-stream'

export const GATED_TOOLS: ReadonlySet<string> = new Set(['run_query', 'run_write'])

const idParam = { type: 'object', properties: {}, required: [] }
const tableParam = {
  type: 'object',
  properties: { schema: { type: 'string' }, table: { type: 'string' } },
  required: ['schema', 'table']
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    type: 'function',
    function: { name: 'list_schemas', description: 'List schemas.', parameters: idParam }
  },
  {
    type: 'function',
    function: {
      name: 'list_tables',
      description: 'List tables and views in a schema.',
      parameters: {
        type: 'object',
        properties: { schema: { type: 'string' } },
        required: ['schema']
      }
    }
  },
  {
    type: 'function',
    function: { name: 'get_columns', description: 'Describe a table.', parameters: tableParam }
  },
  {
    type: 'function',
    function: { name: 'get_keys', description: 'Keys of a table.', parameters: tableParam }
  },
  {
    type: 'function',
    function: { name: 'get_indexes', description: 'Indexes of a table.', parameters: tableParam }
  },
  {
    type: 'function',
    function: {
      name: 'run_query',
      description: 'Run one read-only SQL query. Writes are rejected. Capped at 1000 rows.',
      parameters: {
        type: 'object',
        properties: { sql: { type: 'string' } },
        required: ['sql']
      }
    }
  }
]

const RUN_WRITE_SPEC: ToolSpec = {
  type: 'function',
  function: {
    name: 'run_write',
    description:
      'Run a single write statement (INSERT/UPDATE/DELETE or DDL). The user must confirm each write; destructive statements require extra confirmation. Use one statement per call.',
    parameters: {
      type: 'object',
      properties: { sql: { type: 'string' } },
      required: ['sql']
    }
  }
}

/** The tool set exposed to the agent. Writes are present only when the user has
 *  opted in — off by default the agent is exactly the read-only agent. */
export function toolSpecs(allowWrites: boolean): ToolSpec[] {
  return allowWrites ? [...TOOL_SPECS, RUN_WRITE_SPEC] : TOOL_SPECS
}

export interface ToolOutcome {
  ok: boolean
  summary: string
  payload: unknown
}

function ok(payload: unknown, summary: string): ToolOutcome {
  return { ok: true, summary, payload }
}
function fail(message: string): ToolOutcome {
  return { ok: false, summary: message, payload: { error: message } }
}

/** Execute one tool call against the active connection via HostApi. All paths
 *  are read-only; run_query is double-guarded (classifier + executeReadOnly). */
export async function dispatchTool(
  host: HostApi,
  connectionId: string,
  call: ToolCall
): Promise<ToolOutcome> {
  let args: Record<string, unknown>
  try {
    args = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {}
  } catch {
    return fail('invalid tool arguments (not JSON)')
  }
  const s = (k: string): string => String(args[k] ?? '')
  try {
    switch (call.name) {
      case 'list_schemas':
        return ok(await host.listSchemas(connectionId), 'schemas')
      case 'list_tables':
        return ok(await host.listTables(connectionId, s('schema')), 'tables')
      case 'get_columns':
        return ok(await host.getColumns(connectionId, s('schema'), s('table')), 'columns')
      case 'get_keys':
        return ok(await host.getKeys(connectionId, s('schema'), s('table')), 'keys')
      case 'get_indexes':
        return ok(await host.getIndexes(connectionId, s('schema'), s('table')), 'indexes')
      case 'run_query': {
        const sql = s('sql')
        if (!isReadOnlyQuery(sql)) return fail('only read-only queries are allowed')
        const r = await host.executeReadOnly(connectionId, sql)
        const truncated = r.rows.length > MCP_MAX_ROWS
        return ok(
          {
            fields: r.fields,
            rows: truncated ? r.rows.slice(0, MCP_MAX_ROWS) : r.rows,
            rowCount: r.rowCount,
            truncated
          },
          `${Math.min(r.rows.length, MCP_MAX_ROWS)} rows`
        )
      }
      case 'run_write': {
        const sql = s('sql')
        const r = await host.executeQuery(connectionId, sql)
        return ok({ rowCount: r.rowCount, command: r.command }, `${r.rowCount} rows, ${r.command}`)
      }
      default:
        return fail(`unknown tool ${call.name}`)
    }
  } catch (e) {
    return fail((e as Error).message)
  }
}

import { createServer, type IncomingMessage, type Server } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { checkBearer } from '@shared/mcp/auth'
import { isReadOnlyQuery } from '@shared/sql/classify'
import type { HostApi } from '@shared/host/host-api'

/** Hard ceiling on rows a single run_query returns to an agent. */
export const MCP_MAX_ROWS = 1000

/** One entry in the MCP allowlist: an open connection the user opted in. */
export interface McpConnectionInfo {
  connectionId: string
  name: string
  engine: string
}

export interface McpServerDeps {
  host: HostApi
  /** Bearer token every request must present (from the keychain). */
  token: string
  /** The CURRENT allowlist — open connections with `exposeToMcp`. Called fresh
   *  on every tool invocation so a connection closed or un-exposed mid-session
   *  drops out immediately. */
  connections: () => McpConnectionInfo[] | Promise<McpConnectionInfo[]>
}

export interface RunningMcp {
  /** The port actually bound (useful when starting on port 0). */
  readonly port: number
  stop(): Promise<void>
}

interface ToolResult {
  // Index signature matches the SDK's CallToolResult so these satisfy the
  // registerTool callback return type.
  [k: string]: unknown
  content: { type: 'text'; text: string }[]
  isError?: boolean
}
const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }]
})
const err = (message: string): ToolResult => ({
  content: [{ type: 'text', text: `Error: ${message}` }],
  isError: true
})

/** Build a fresh MCP server exposing the read-only tools. One per request in
 *  stateless mode. All data flows through HostApi — never a second path to the
 *  drivers, and secrets never appear (agents address connections by opaque id). */
function buildMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer({ name: 'fordb', version: '1' })

  /** Resolve a connectionId against the live allowlist, or throw. */
  const allowed = async (connectionId: string): Promise<McpConnectionInfo> => {
    const hit = (await deps.connections()).find((c) => c.connectionId === connectionId)
    if (!hit) throw new Error('unknown or not-exposed connection')
    return hit
  }

  server.registerTool(
    'list_connections',
    {
      description:
        'List the database connections exposed to this MCP server (opted-in and currently open). Returns opaque connectionIds to address the other tools.'
    },
    async () => ok(await deps.connections())
  )

  const idSchema = { connectionId: z.string() }
  const tableSchema = { connectionId: z.string(), schema: z.string(), table: z.string() }

  server.registerTool(
    'list_schemas',
    { description: 'List schemas for a connection.', inputSchema: idSchema },
    async ({ connectionId }) => {
      try {
        await allowed(connectionId)
        return ok(await deps.host.listSchemas(connectionId))
      } catch (e) {
        return err((e as Error).message)
      }
    }
  )

  server.registerTool(
    'list_tables',
    {
      description: 'List tables and views in a schema.',
      inputSchema: { connectionId: z.string(), schema: z.string() }
    },
    async ({ connectionId, schema }) => {
      try {
        await allowed(connectionId)
        return ok(await deps.host.listTables(connectionId, schema))
      } catch (e) {
        return err((e as Error).message)
      }
    }
  )

  server.registerTool(
    'get_columns',
    { description: 'Describe the columns of a table.', inputSchema: tableSchema },
    async ({ connectionId, schema, table }) => {
      try {
        await allowed(connectionId)
        return ok(await deps.host.getColumns(connectionId, schema, table))
      } catch (e) {
        return err((e as Error).message)
      }
    }
  )

  server.registerTool(
    'get_keys',
    { description: 'List primary, foreign, and unique keys of a table.', inputSchema: tableSchema },
    async ({ connectionId, schema, table }) => {
      try {
        await allowed(connectionId)
        return ok(await deps.host.getKeys(connectionId, schema, table))
      } catch (e) {
        return err((e as Error).message)
      }
    }
  )

  server.registerTool(
    'get_indexes',
    { description: 'List indexes of a table.', inputSchema: tableSchema },
    async ({ connectionId, schema, table }) => {
      try {
        await allowed(connectionId)
        return ok(await deps.host.getIndexes(connectionId, schema, table))
      } catch (e) {
        return err((e as Error).message)
      }
    }
  )

  server.registerTool(
    'run_query',
    {
      description:
        'Run a single read-only SQL query (SELECT/WITH/EXPLAIN/…). Writes are rejected. Results are capped at 1000 rows.',
      inputSchema: { connectionId: z.string(), sql: z.string() }
    },
    async ({ connectionId, sql }) => {
      try {
        await allowed(connectionId)
        // Layer 1: reject anything not provably read-only before it touches the
        // engine. Layer 2 (executeReadOnly) is the engine-enforced boundary.
        if (!isReadOnlyQuery(sql)) return err('only read-only queries are allowed')
        const r = await deps.host.executeReadOnly(connectionId, sql)
        const truncated = r.rows.length > MCP_MAX_ROWS
        return ok({
          fields: r.fields,
          rows: truncated ? r.rows.slice(0, MCP_MAX_ROWS) : r.rows,
          rowCount: r.rowCount,
          truncated
        })
      } catch (e) {
        return err((e as Error).message)
      }
    }
  )

  return server
}

/** Read and JSON-parse a request body (stateless transport needs it pre-parsed). */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve(undefined)
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/** Start the read-only MCP server bound to `host` (always 127.0.0.1 in prod).
 *  Stateless: a fresh MCP server + transport per POST. Bearer-gated. */
export function startMcpServer(
  deps: McpServerDeps,
  host: string,
  port: number
): Promise<RunningMcp> {
  const httpServer: Server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      if (!checkBearer(deps.token, req.headers.authorization)) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Unauthorized' },
            id: null
          })
        )
        return
      }
      let body: unknown
      try {
        body = await readJsonBody(req)
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error' },
            id: null
          })
        )
        return
      }
      const server = buildMcpServer(deps)
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      res.on('close', () => {
        void transport.close()
        void server.close()
      })
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    })()
  })

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(port, host, () => {
      const addr = httpServer.address()
      const bound = typeof addr === 'object' && addr ? addr.port : port
      resolve({
        port: bound,
        stop: () => new Promise<void>((res, rej) => httpServer.close((e) => (e ? rej(e) : res())))
      })
    })
  })
}

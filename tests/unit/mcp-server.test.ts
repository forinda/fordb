import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  startMcpServer,
  type McpConnectionInfo,
  type McpServerDeps,
  type RunningMcp
} from '../../src/main/mcp/server'
import type { HostApi } from '../../src/shared/host/host-api'
import type { QueryResult } from '../../src/shared/adapter/types'

const TOKEN = 'test-token-abc'

/** Minimal HostApi stub: only the methods the MCP tools call. Records the last
 *  SQL sent to executeReadOnly so we can assert the classifier gate. */
function fakeHost(): { host: HostApi; lastReadOnlySql: () => string | null } {
  let lastSql: string | null = null
  const host = {
    listSchemas: async () => ['public'],
    listTables: async () => [{ schema: 'public', name: 'users', type: 'table' as const }],
    getColumns: async () => [
      { name: 'id', dataType: 'int', nullable: false, defaultValue: null, ordinal: 1 }
    ],
    getKeys: async () => [],
    getIndexes: async () => [],
    executeReadOnly: async (_id: string, sql: string): Promise<QueryResult> => {
      lastSql = sql
      return {
        fields: [{ name: 'n', dataType: 'int' }],
        rows: [[1]],
        rowCount: 1,
        command: 'SELECT'
      }
    }
  } as unknown as HostApi
  return { host, lastReadOnlySql: () => lastSql }
}

const CONNS: McpConnectionInfo[] = [
  { connectionId: 'conn-1', name: 'Local PG', engine: 'postgres' }
]

async function start(deps: Partial<McpServerDeps> = {}): Promise<RunningMcp> {
  const base = fakeHost()
  const full: McpServerDeps = {
    host: base.host,
    token: TOKEN,
    connections: () => CONNS,
    ...deps
  }
  return startMcpServer(full, '127.0.0.1', 0)
}

async function connectClient(port: number, token = TOKEN): Promise<Client> {
  const client = new Client({ name: 'test', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  })
  await client.connect(transport)
  return client
}

let running: RunningMcp | null = null
afterEach(async () => {
  await running?.stop()
  running = null
})

describe('MCP server', () => {
  it('rejects a request with no bearer token (401)', async () => {
    running = await start()
    const res = await fetch(`http://127.0.0.1:${running.port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
    })
    expect(res.status).toBe(401)
  })

  it('rejects a wrong bearer token (401)', async () => {
    running = await start()
    const res = await fetch(`http://127.0.0.1:${running.port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer nope' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
    })
    expect(res.status).toBe(401)
  })

  it('lists the read-only tool surface with a valid token', async () => {
    running = await start()
    const client = await connectClient(running.port)
    const names = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(names).toEqual([
      'get_columns',
      'get_indexes',
      'get_keys',
      'list_connections',
      'list_schemas',
      'list_tables',
      'run_query'
    ])
    await client.close()
  })

  it('list_connections returns the allowlist', async () => {
    running = await start()
    const client = await connectClient(running.port)
    const r = await client.callTool({ name: 'list_connections', arguments: {} })
    const text = (r.content as { text: string }[])[0]!.text
    expect(JSON.parse(text)).toEqual(CONNS)
    await client.close()
  })

  it('run_query runs a SELECT through executeReadOnly', async () => {
    const base = fakeHost()
    running = await start({ host: base.host, connections: () => CONNS })
    const client = await connectClient(running.port)
    const r = await client.callTool({
      name: 'run_query',
      arguments: { connectionId: 'conn-1', sql: 'SELECT 1 AS n' }
    })
    expect(r.isError).toBeFalsy()
    expect(base.lastReadOnlySql()).toBe('SELECT 1 AS n')
    await client.close()
  })

  it('run_query rejects a write before it reaches the engine', async () => {
    const base = fakeHost()
    running = await start({ host: base.host, connections: () => CONNS })
    const client = await connectClient(running.port)
    const r = await client.callTool({
      name: 'run_query',
      arguments: { connectionId: 'conn-1', sql: 'DELETE FROM users' }
    })
    expect(r.isError).toBe(true)
    // The classifier gate fired — executeReadOnly was never called.
    expect(base.lastReadOnlySql()).toBeNull()
    await client.close()
  })

  it('rejects a tool call for a connection not on the allowlist', async () => {
    running = await start({ connections: () => [] })
    const client = await connectClient(running.port)
    const r = await client.callTool({
      name: 'list_schemas',
      arguments: { connectionId: 'conn-1' }
    })
    expect(r.isError).toBe(true)
    await client.close()
  })
})

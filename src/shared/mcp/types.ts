/** MCP server state surfaced to the settings UI. The token is local-only — the
 *  user copies it into their agent config; it never leaves the machine. */
export interface McpStatus {
  enabled: boolean
  port: number
  running: boolean
  token: string
}

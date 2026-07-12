import { createRpcClient } from '@shared/rpc/client'
import type { HostApi } from '@shared/host/host-api'
import type { HistoryEntry, SavedQuery } from '@shared/query/library-types'
import type { UpdaterStatus } from '@shared/updater'
import type { McpStatus } from '@shared/mcp/types'
import type { AiConfigPublic, AiEvent } from '@shared/ai/types'
import type { Conversation, ConversationSummary } from '@shared/ai/conversation-types'

declare global {
  interface Window {
    fordb: {
      getDbHostPort: () => Promise<import('@shared/rpc/protocol').PortLike>
      profiles: {
        list: () => Promise<import('@shared/adapter/types').ConnectionProfile[]>
        save: (
          p: import('@shared/adapter/types').ConnectionProfile,
          secrets: {
            password?: string
            sshPassword?: string
            sshPassphrase?: string
            authToken?: string
            uri?: string
          }
        ) => Promise<void>
        delete: (id: string) => Promise<void>
      }
      queries: {
        historyList: (profileId: string) => Promise<HistoryEntry[]>
        historyAdd: (profileId: string, sql: string) => Promise<void>
        savedList: (profileId: string) => Promise<SavedQuery[]>
        save: (profileId: string, name: string, sql: string) => Promise<SavedQuery>
        deleteSaved: (profileId: string, id: string) => Promise<void>
      }
      conversations: {
        list: (profileId: string) => Promise<ConversationSummary[]>
        get: (profileId: string, id: string) => Promise<Conversation | null>
        save: (profileId: string, c: Conversation) => Promise<void>
        delete: (profileId: string, id: string) => Promise<void>
      }
      connection: {
        test: (profileId: string) => Promise<{ ok: boolean; error?: string }>
        open: (profileId: string, database?: string) => Promise<string>
        close: (connectionId: string) => Promise<void>
      }
      platform: 'darwin' | 'win32' | 'linux'
      windowControls: {
        minimize: () => void
        maximize: () => void
        close: () => void
        isMaximized: () => Promise<boolean>
        onMaximizeChanged: (cb: (max: boolean) => void) => () => void
      }
      appearance: {
        initialTheme: 'light' | 'dark'
        getMode: () => Promise<'light' | 'dark' | 'system'>
        setMode: (mode: 'light' | 'dark' | 'system') => Promise<void>
        onThemeChanged: (cb: (t: 'light' | 'dark') => void) => void
      }
      dialog: {
        openFile: () => Promise<string | null>
        openTextFile: (exts: string[]) => Promise<{ name: string; text: string } | null>
      }
      exportFile: {
        save: (defaultName: string, text: string, gzip: boolean) => Promise<boolean>
      }
      onDbHostRestarted: (cb: () => void) => void
      mcp: {
        status: () => Promise<McpStatus>
        setEnabled: (enabled: boolean) => Promise<McpStatus>
        setPort: (port: number) => Promise<McpStatus>
        regenerateToken: () => Promise<McpStatus>
      }
      ai: {
        getConfig: () => Promise<AiConfigPublic>
        setConfig: (baseUrl: string, model: string, allowWrites: boolean) => Promise<void>
        setKey: (key: string) => Promise<void>
        test: () => Promise<{ ok: boolean; message?: string }>
        ask: (prompt: string, connectionId: string) => Promise<void>
        approve: (toolId: string, approved: boolean) => Promise<void>
        cancel: () => Promise<void>
        onEvent: (cb: (e: AiEvent) => void) => () => void
      }
      appVersion: () => Promise<string>
      updater: {
        check: () => Promise<void>
        install: () => Promise<void>
        getAuto: () => Promise<boolean>
        setAuto: (enabled: boolean) => Promise<void>
        onStatus: (cb: (s: UpdaterStatus) => void) => () => void
      }
    }
  }
}

// A generous finite timeout so a call to a hung-but-alive db-host (which emits
// no 'exit' event, so no connection-lost broadcast) rejects instead of hanging
// forever. User cancel remains the primary stop for long queries; this is the
// safety net.
const RPC_TIMEOUT_MS = 120_000

let clientPromise: Promise<HostApi> | null = null
export function hostApi(): Promise<HostApi> {
  if (!clientPromise) {
    clientPromise = window.fordb
      .getDbHostPort()
      .then((port) => createRpcClient<HostApi>(port, { timeoutMs: RPC_TIMEOUT_MS }))
  }
  return clientPromise
}

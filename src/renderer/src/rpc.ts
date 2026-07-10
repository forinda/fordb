import { createRpcClient } from '@shared/rpc/client'
import type { HostApi } from '@shared/host/host-api'
import type { HistoryEntry, SavedQuery } from '@shared/query/library-types'

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
        onMaximizeChanged: (cb: (max: boolean) => void) => void
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

import { createRpcClient } from '../../shared/rpc/client'
import type { HostApi } from '../../shared/host/host-api'

declare global {
  interface Window {
    fordb: {
      getDbHostPort: () => Promise<import('../../shared/rpc/protocol').PortLike>
      profiles: {
        list: () => Promise<import('../../shared/adapter/types').ConnectionProfile[]>
        save: (
          p: import('../../shared/adapter/types').ConnectionProfile,
          secrets: { password?: string; sshPassword?: string; sshPassphrase?: string }
        ) => Promise<void>
        delete: (id: string) => Promise<void>
      }
      connection: {
        test: (profileId: string) => Promise<{ ok: boolean; error?: string }>
        open: (profileId: string) => Promise<string>
        close: (connectionId: string) => Promise<void>
      }
    }
  }
}

let clientPromise: Promise<HostApi> | null = null
export function hostApi(): Promise<HostApi> {
  if (!clientPromise) {
    clientPromise = window.fordb.getDbHostPort().then((port) => createRpcClient<HostApi>(port))
  }
  return clientPromise
}

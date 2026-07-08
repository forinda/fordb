import { create } from 'zustand'
import type { ConnectionProfile } from '@shared/adapter/types'

interface ConnState {
  profiles: ConnectionProfile[]
  activeConnectionId: string | null
  activeProfileId: string | null
  loadProfiles: () => Promise<void>
  setActive: (connectionId: string, profileId: string) => void
  clearActive: () => void
}

export const useConnStore = create<ConnState>((set) => ({
  profiles: [],
  activeConnectionId: null,
  activeProfileId: null,
  loadProfiles: async () => set({ profiles: await window.fordb.profiles.list() }),
  setActive: (connectionId, profileId) =>
    set({ activeConnectionId: connectionId, activeProfileId: profileId }),
  clearActive: () => set({ activeConnectionId: null, activeProfileId: null })
}))

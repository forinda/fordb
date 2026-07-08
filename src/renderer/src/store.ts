import { create } from 'zustand'

interface ConnState {
  activeConnectionId: string | null
  activeProfileId: string | null
  setActive: (connectionId: string, profileId: string) => void
  clearActive: () => void
}

export const useConnStore = create<ConnState>((set) => ({
  activeConnectionId: null,
  activeProfileId: null,
  setActive: (connectionId, profileId) =>
    set({ activeConnectionId: connectionId, activeProfileId: profileId }),
  clearActive: () => set({ activeConnectionId: null, activeProfileId: null })
}))

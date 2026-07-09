import { create } from 'zustand'

interface ConnState {
  activeConnectionId: string | null
  activeProfileId: string | null
  /** The database the active connection is on (for the DB switcher). */
  activeDatabase: string | null
  setActive: (connectionId: string, profileId: string, database: string | null) => void
  clearActive: () => void
}

export const useConnStore = create<ConnState>((set) => ({
  activeConnectionId: null,
  activeProfileId: null,
  activeDatabase: null,
  setActive: (connectionId, profileId, database) =>
    set({ activeConnectionId: connectionId, activeProfileId: profileId, activeDatabase: database }),
  clearActive: () => set({ activeConnectionId: null, activeProfileId: null, activeDatabase: null })
}))

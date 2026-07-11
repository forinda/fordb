import { create } from 'zustand'
import { useEffect } from 'react'
import type { UpdaterStatus } from '@shared/updater'

interface UpdaterState {
  status: UpdaterStatus
  set: (s: UpdaterStatus) => void
  dismissed: boolean
  dismiss: () => void
}

export const useUpdaterStore = create<UpdaterState>((set) => ({
  status: { status: 'idle' },
  set: (status) => set({ status, dismissed: false }),
  dismissed: false,
  dismiss: () => set({ dismissed: true })
}))

/** Wire the main→renderer status push once, at app mount. */
export function useUpdaterSubscription(): void {
  const set = useUpdaterStore((s) => s.set)
  useEffect(() => window.fordb.updater.onStatus(set), [set])
}

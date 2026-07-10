import { create } from 'zustand'

/** Transient UI state shared across the shell: the connecting overlay and the
 *  run toast. Kept out of the data stores so it can be driven from anywhere. */
interface UiState {
  /** Non-null while a connection is being opened — drives the overlay. */
  connecting: { label: string; host: string } | null
  setConnecting: (v: { label: string; host: string } | null) => void

  /** Transient toast (auto-dismissed by the component). */
  toast: { id: number; kind: 'ok' | 'error'; message: string } | null
  showToast: (kind: 'ok' | 'error', message: string) => void
  clearToast: () => void
}

let toastSeq = 1

export const useUiStore = create<UiState>((set) => ({
  connecting: null,
  setConnecting: (connecting) => set({ connecting }),
  toast: null,
  showToast: (kind, message) => set({ toast: { id: toastSeq++, kind, message } }),
  clearToast: () => set({ toast: null })
}))

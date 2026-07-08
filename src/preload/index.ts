import { contextBridge } from 'electron'

// Populated further in Task 3 (port plumbing). This exposeInMainWorld call is
// a legitimate permanent placeholder proving the preload bridge loads and
// executes real module-shaped code (contextBridge / ipcRenderer) under the
// project's ESM preload output. The next task replaces the payload.
contextBridge.exposeInMainWorld('fordbPing', { ok: true })

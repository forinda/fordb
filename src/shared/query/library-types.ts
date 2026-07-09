export interface HistoryEntry {
  sql: string
  ts: number
}
export interface SavedQuery {
  id: string
  name: string
  sql: string
  createdAt: number
}

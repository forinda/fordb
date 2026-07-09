import { useEffect, useState } from 'react'
import { useConnStore } from '../store'
import { useQueryStore } from '../store-query'
import { QueryPickerDialog, type PickerItem } from './QueryPickerDialog'

const firstLine = (sql: string): string => sql.trim().split('\n')[0]?.slice(0, 120) ?? ''

/** The active query tab's SQL (empty when the active tab isn't an editor). */
function currentSql(): string {
  const s = useQueryStore.getState()
  const t = s.tabs.find((x) => x.id === s.activeTabId)
  return t && t.kind === 'query' ? t.sql : ''
}

const savedItems = (s: { id: string; name: string; sql: string }[]): PickerItem[] =>
  s.map((q) => ({ id: q.id, label: q.name, sublabel: firstLine(q.sql), sql: q.sql }))

/** Renders the history/saved picker or the save-name input, driven by the query
 *  store's `picker` state (opened from the toolbar or the command palette). */
export function QueryLibrary(): React.JSX.Element | null {
  const picker = useQueryStore((s) => s.picker)
  const setPicker = useQueryStore((s) => s.setPicker)
  const loadIntoEditor = useQueryStore((s) => s.loadIntoEditor)
  const profileId = useConnStore((s) => s.activeProfileId)
  const [items, setItems] = useState<PickerItem[]>([])
  const [name, setName] = useState('')

  useEffect(() => {
    if (!profileId) return
    setName('')
    // Ignore a stale response if picker/profile changes before it resolves.
    let live = true
    if (picker === 'history')
      void window.fordb.queries
        .historyList(profileId)
        .then((h) => {
          if (live) setItems(h.map((e) => ({ label: firstLine(e.sql), sql: e.sql })))
        })
        .catch(() => {
          if (live) setItems([])
        })
    else if (picker === 'saved')
      void window.fordb.queries
        .savedList(profileId)
        .then((s) => {
          if (live) setItems(savedItems(s))
        })
        .catch(() => {
          if (live) setItems([])
        })
    return () => {
      live = false
    }
  }, [picker, profileId])

  if (!picker || !profileId) return null

  async function submitSave(): Promise<void> {
    const sql = currentSql()
    if (!profileId || !name.trim() || !sql.trim()) return
    await window.fordb.queries.save(profileId, name.trim(), sql)
    setPicker(null)
  }

  if (picker === 'save') {
    const canSave = !!name.trim() && !!currentSql().trim()
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
        <div className="w-96 max-w-[90vw] rounded border border-border bg-background p-3 shadow-lg">
          <div className="mb-2 text-sm font-medium">Save query</div>
          <input
            aria-label="save-query-name"
            autoFocus
            className="mb-2 w-full rounded border border-border bg-background px-2 py-1 text-sm"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitSave()
              if (e.key === 'Escape') setPicker(null)
            }}
          />
          <div className="flex justify-end gap-2">
            <button
              className="rounded px-2 py-0.5 text-sm hover:bg-muted"
              onClick={() => setPicker(null)}
            >
              Cancel
            </button>
            <button
              className="rounded bg-primary px-2 py-0.5 text-sm text-primary-foreground disabled:opacity-50"
              disabled={!canSave}
              onClick={() => void submitSave()}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <QueryPickerDialog
      title={picker === 'history' ? 'Query history' : 'Saved queries'}
      items={items}
      onPick={(sql) => loadIntoEditor(sql)}
      onClose={() => setPicker(null)}
      onDelete={
        picker === 'saved'
          ? (id) =>
              void window.fordb.queries
                .deleteSaved(profileId, id)
                .then(() => window.fordb.queries.savedList(profileId))
                .then((s) => setItems(savedItems(s)))
                .catch(() => {})
          : undefined
      }
    />
  )
}

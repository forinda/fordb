import { useState } from 'react'

export interface PickerItem {
  id?: string
  label: string // primary text (name or a SQL preview)
  sublabel?: string // secondary (relative time, etc.)
  sql: string
}

/** A filterable overlay list for picking a query (history or saved). onDelete,
 *  when given, shows a per-row delete (saved-queries mode). */
export function QueryPickerDialog(props: {
  title: string
  items: PickerItem[]
  onPick: (sql: string) => void
  onClose: () => void
  onDelete?: (id: string) => void
}): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const f = filter.toLowerCase()
  const items = f
    ? props.items.filter(
        (i) => i.label.toLowerCase().includes(f) || i.sql.toLowerCase().includes(f)
      )
    : props.items

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24">
      <div
        className="flex max-h-[60vh] w-[36rem] max-w-[90vw] flex-col rounded border border-border bg-background shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border p-2">
          <span className="text-sm font-medium">{props.title}</span>
          <button className="ml-auto text-sm hover:underline" onClick={props.onClose}>
            close
          </button>
        </div>
        <input
          aria-label="query-picker-filter"
          autoFocus
          className="border-b border-border bg-background px-2 py-1 text-sm"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {items.length === 0 && <div className="p-3 text-sm text-muted-foreground">Nothing.</div>}
          {items.map((i, idx) => (
            <div
              key={i.id ?? idx}
              className="flex items-center gap-2 border-b border-border px-2 py-1 hover:bg-muted"
            >
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  props.onPick(i.sql)
                  props.onClose()
                }}
              >
                <div className="truncate font-mono text-xs">{i.label}</div>
                {i.sublabel && <div className="text-xs text-muted-foreground">{i.sublabel}</div>}
              </button>
              {props.onDelete && i.id && (
                <button
                  aria-label="query-picker-delete"
                  className="shrink-0 px-1 text-xs text-destructive hover:underline"
                  onClick={() => props.onDelete!(i.id!)}
                >
                  delete
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

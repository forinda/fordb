import { useEffect, useState } from 'react'
import { hostApi } from '../rpc'
import { useConnStore } from '../store'
import type { ColumnInfo, IndexInfo, KeyInfo } from '@shared/adapter/types'

interface Info {
  columns: ColumnInfo[]
  keys: KeyInfo[]
  indexes: IndexInfo[]
}

/** Read-only structure view for a table: columns, keys, indexes. */
export function TableInfoDialog(props: {
  schema: string
  table: string
  onClose: () => void
}): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  const [info, setInfo] = useState<Info | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!connId) return
    let cancelled = false
    void (async () => {
      try {
        const api = await hostApi()
        const [columns, keys, indexes] = await Promise.all([
          api.getColumns(connId, props.schema, props.table),
          api.getKeys(connId, props.schema, props.table),
          api.getIndexes(connId, props.schema, props.table)
        ])
        if (!cancelled) setInfo({ columns, keys, indexes })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connId, props.schema, props.table])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={props.onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded border border-border bg-background p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium text-foreground">
            {props.schema}.{props.table}
          </h2>
          <button
            className="rounded px-2 py-0.5 text-muted-foreground hover:bg-muted"
            onClick={props.onClose}
          >
            Close
          </button>
        </div>
        {error && <div className="text-sm text-destructive">{error}</div>}
        {!info && !error && <div className="text-sm text-muted-foreground">Loading…</div>}
        {info && (
          <div className="flex flex-col gap-4 text-sm">
            <section>
              <div className="mb-1 font-medium text-muted-foreground">Columns</div>
              <table className="w-full">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-0.5 pr-3 font-medium">Name</th>
                    <th className="py-0.5 pr-3 font-medium">Type</th>
                    <th className="py-0.5 pr-3 font-medium">Nullable</th>
                    <th className="py-0.5 font-medium">Default</th>
                  </tr>
                </thead>
                <tbody>
                  {info.columns.map((c) => (
                    <tr key={c.name} className="border-t border-border text-foreground">
                      <td className="py-0.5 pr-3 font-mono">{c.name}</td>
                      <td className="py-0.5 pr-3">{c.dataType}</td>
                      <td className="py-0.5 pr-3">{c.nullable ? 'yes' : 'no'}</td>
                      <td className="py-0.5 font-mono text-xs">{c.defaultValue ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section>
              <div className="mb-1 font-medium text-muted-foreground">Keys</div>
              {info.keys.length === 0 ? (
                <div className="text-muted-foreground">None</div>
              ) : (
                info.keys.map((k) => (
                  <div key={k.name} className="text-foreground">
                    <span className="text-muted-foreground">{k.kind}</span> ({k.columns.join(', ')})
                    {k.referencedTable ? ` → ${k.referencedTable}` : ''}
                  </div>
                ))
              )}
            </section>
            <section>
              <div className="mb-1 font-medium text-muted-foreground">Indexes</div>
              {info.indexes.length === 0 ? (
                <div className="text-muted-foreground">None</div>
              ) : (
                info.indexes.map((i) => (
                  <div key={i.name} className="text-foreground">
                    <span className="font-mono">{i.name}</span> ({i.columns.join(', ')})
                    {i.unique ? ' · unique' : ''}
                  </div>
                ))
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

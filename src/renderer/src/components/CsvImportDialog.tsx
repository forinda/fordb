import { useEffect, useState } from 'react'
import { useConnStore } from '../store'
import { useQueryStore } from '../store-query'
import { useColumns } from '../query/introspection'

/** CSV column-mapping dialog. Driven by the query store's `csvImport` job; maps
 *  each CSV column to a target table column (or skip), then inserts the rows via
 *  the data mutator (one transaction). */
export function CsvImportDialog(): React.JSX.Element | null {
  const job = useQueryStore((s) => s.csvImport)
  const cancel = useQueryStore((s) => s.cancelCsvImport)
  const apply = useQueryStore((s) => s.applyCsvImport)
  const connId = useConnStore((s) => s.activeConnectionId)
  const { data: cols = [] } = useColumns(connId, job?.schema ?? null, job?.table ?? null)
  const [mapping, setMapping] = useState<(string | null)[]>([])

  // Auto-map CSV headers to same-named target columns when the job/columns load.
  useEffect(() => {
    if (!job) return
    const names = new Set(cols.map((c) => c.name))
    setMapping(job.headers.map((h) => (names.has(h) ? h : null)))
  }, [job, cols])

  if (!job) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-20">
      <div className="flex max-h-[70vh] w-[40rem] max-w-[90vw] flex-col rounded border border-border bg-background p-3 text-sm shadow-lg">
        <div className="mb-2 flex items-center gap-2">
          <span className="font-medium">
            Import CSV → {job.schema}.{job.table}
          </span>
          <span className="text-muted-foreground">{job.rows.length} rows</span>
          <button className="ml-auto hover:underline" onClick={cancel}>
            close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {job.headers.map((h, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <span className="w-40 shrink-0 truncate font-mono text-xs">{h}</span>
              <span className="text-muted-foreground">→</span>
              <select
                aria-label={`csv-map-${i}`}
                className="rounded border border-border bg-background px-1 py-0.5"
                value={mapping[i] ?? ''}
                onChange={(e) =>
                  setMapping((m) => m.map((x, j) => (j === i ? e.target.value || null : x)))
                }
              >
                <option value="">(skip)</option>
                {cols.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <button className="rounded px-2 py-0.5 hover:bg-muted" onClick={cancel}>
            Cancel
          </button>
          <button
            className="rounded bg-primary px-2 py-0.5 text-primary-foreground disabled:opacity-50"
            disabled={mapping.every((m) => m === null)}
            onClick={() => void apply(mapping)}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  )
}

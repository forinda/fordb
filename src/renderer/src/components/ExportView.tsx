import { useEffect, useState } from 'react'
import { useConnStore } from '../store'
import { useQueryStore } from '../store-query'
import { useDialect } from '../query/use-dialect'
import { useSchemas, useTables } from '../query/introspection'

/** Export destination page (Adminer-flat): dump a schema (or a chosen subset of
 *  its tables) to a single SQL file, or one table to CSV. Wraps the store's
 *  exportSql / exportTableCsv; the file lands via the native save dialog. */
export function ExportView(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  const { dialect } = useDialect()
  const exportSql = useQueryStore((s) => s.exportSql)
  const exportTableCsv = useQueryStore((s) => s.exportTableCsv)

  const { data: schemas = [] } = useSchemas(connId)
  const [schema, setSchema] = useState('')
  const effectiveSchema = schema || schemas[0] || ''
  const { data: allTables = [] } = useTables(connId, effectiveSchema || null)
  const tables = allTables.filter((t) => t.type === 'table').map((t) => t.name)

  const [format, setFormat] = useState<'sql' | 'csv'>('sql')
  const [gzip, setGzip] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [csvTable, setCsvTable] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  // Default to all tables selected (SQL) and the first table (CSV) whenever the
  // table list changes (schema switch / load).
  useEffect(() => {
    setPicked(new Set(tables))
    setCsvTable(tables[0] ?? '')
    setResult(null)
  }, [effectiveSchema, tables.join(',')])

  function toggle(name: string): void {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function run(): Promise<void> {
    if (!effectiveSchema || busy) return
    setBusy(true)
    setResult(null)
    const ok =
      format === 'csv'
        ? await exportTableCsv(effectiveSchema, csvTable)
        : await exportSql(
            { kind: 'database', schema: effectiveSchema, tables: [...picked] },
            gzip,
            dialect
          )
    const err = useQueryStore.getState().ioError
    setResult(
      ok
        ? format === 'csv'
          ? `Exported ${csvTable}.csv`
          : `Exported ${effectiveSchema}.sql${gzip ? '.gz' : ''} (${picked.size} table${picked.size === 1 ? '' : 's'})`
        : `Export failed${err ? `: ${err}` : ''}`
    )
    setBusy(false)
  }

  const canRun = format === 'csv' ? !!csvTable : picked.size > 0

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 overflow-auto p-6">
      <h1 className="text-lg font-semibold text-foreground">Export</h1>

      <label className="flex items-center gap-2 text-sm">
        <span className="w-20 text-muted-foreground">Schema</span>
        <select
          aria-label="export-schema"
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1"
          value={effectiveSchema}
          onChange={(e) => setSchema(e.target.value)}
        >
          {schemas.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-4 text-sm">
        <span className="w-20 text-muted-foreground">Format</span>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="export-format"
            checked={format === 'sql'}
            onChange={() => setFormat('sql')}
          />
          SQL
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="export-format"
            checked={format === 'csv'}
            onChange={() => setFormat('csv')}
          />
          CSV
        </label>
      </div>

      {format === 'sql' ? (
        <>
          <div className="rounded border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
              <span>
                Tables ({picked.size}/{tables.length})
              </span>
              <div className="flex gap-2">
                <button
                  className="hover:text-foreground"
                  onClick={() => setPicked(new Set(tables))}
                >
                  all
                </button>
                <button className="hover:text-foreground" onClick={() => setPicked(new Set())}>
                  none
                </button>
              </div>
            </div>
            <div className="max-h-64 overflow-auto p-2">
              {tables.length === 0 && (
                <div className="px-1 py-2 text-sm text-muted-foreground">
                  No tables in this schema.
                </div>
              )}
              {tables.map((t) => (
                <label key={t} className="flex items-center gap-2 px-1 py-0.5 text-sm">
                  <input type="checkbox" checked={picked.has(t)} onChange={() => toggle(t)} />
                  <span className="truncate">{t}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={gzip} onChange={(e) => setGzip(e.target.checked)} />
            gzip (.sql.gz)
          </label>
        </>
      ) : (
        <label className="flex items-center gap-2 text-sm">
          <span className="w-20 text-muted-foreground">Table</span>
          <select
            aria-label="export-csv-table"
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1"
            value={csvTable}
            onChange={(e) => setCsvTable(e.target.value)}
          >
            {tables.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex items-center gap-3">
        <button
          className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
          onClick={() => void run()}
          disabled={busy || !canRun}
        >
          {busy ? 'Exporting…' : 'Export'}
        </button>
        {result && <span className="text-sm text-muted-foreground">{result}</span>}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useConnStore } from '../store'
import { useQueryStore } from '../store-query'
import { useSchemas, useTables } from '../query/introspection'

/** Import destination page (Adminer-flat): run a .sql/.sql.gz script, or load a
 *  CSV into a chosen table. SQL runs via the store's importSqlFile; CSV hands
 *  off to the existing column-mapping dialog (beginCsvImport). */
export function ImportView(): React.JSX.Element {
  const connId = useConnStore((s) => s.activeConnectionId)
  const importSqlFile = useQueryStore((s) => s.importSqlFile)
  const beginCsvImport = useQueryStore((s) => s.beginCsvImport)

  const { data: schemas = [] } = useSchemas(connId)
  const [schema, setSchema] = useState('')
  const effectiveSchema = schema || schemas[0] || ''
  const { data: allTables = [] } = useTables(connId, effectiveSchema || null)
  const tables = allTables.filter((t) => t.type === 'table').map((t) => t.name)

  const [format, setFormat] = useState<'sql' | 'csv'>('sql')
  const [csvTable, setCsvTable] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    setCsvTable(tables[0] ?? '')
    setResult(null)
  }, [effectiveSchema, tables.join(',')])

  async function runSql(): Promise<void> {
    if (busy) return
    setBusy(true)
    setResult(null)
    const count = await importSqlFile()
    const err = useQueryStore.getState().ioError
    // null with no error = the user cancelled the file picker — say nothing.
    if (count != null) setResult(`Ran ${count} statement${count === 1 ? '' : 's'}`)
    else if (err) setResult(`Import failed: ${err}`)
    setBusy(false)
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 overflow-auto p-6">
      <h1 className="text-lg font-semibold text-foreground">Import</h1>

      <div className="flex items-center gap-4 text-sm">
        <span className="w-20 text-muted-foreground">Format</span>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="import-format"
            checked={format === 'sql'}
            onChange={() => setFormat('sql')}
          />
          SQL
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="import-format"
            checked={format === 'csv'}
            onChange={() => setFormat('csv')}
          />
          CSV
        </label>
      </div>

      {format === 'sql' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Run a .sql or .sql.gz script against the current connection. Its own BEGIN/COMMIT are
            stripped — the whole batch runs in one transaction.
          </p>
          <button
            className="self-start rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
            onClick={() => void runSql()}
            disabled={busy}
          >
            {busy ? 'Running…' : 'Choose SQL file…'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="w-20 text-muted-foreground">Schema</span>
            <select
              aria-label="import-schema"
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
          <label className="flex items-center gap-2 text-sm">
            <span className="w-20 text-muted-foreground">Table</span>
            <select
              aria-label="import-csv-table"
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
          <p className="text-sm text-muted-foreground">
            Pick a CSV file to map its columns into <span className="font-mono">{csvTable}</span>.
          </p>
          <button
            className="self-start rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
            onClick={() => void beginCsvImport(effectiveSchema, csvTable)}
            disabled={!csvTable}
          >
            Choose CSV file…
          </button>
        </div>
      )}

      {result && <span className="text-sm text-muted-foreground">{result}</span>}
    </div>
  )
}

import { useCallback, useEffect, useState, useMemo } from 'react'
import {
  DataEditor,
  GridCellKind,
  CompactSelection,
  type GridCell,
  type EditableGridCell,
  type GridSelection,
  type Item
} from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import { buildEdits, previewEdits, type PendingEdits } from '@shared/mutation/build-edits'
import type { Cell } from '@shared/adapter/mutation-types'
import type { Filter, FilterOp, Sort } from '@shared/adapter/browse-types'
import { buildBrowseSql } from '@shared/browse/build-browse'
import { useDialect } from '../query/use-dialect'
import { dialectGlideTheme, liveStyleGetter } from '../query/glide-theme'
import { useThemeStore } from '../store-theme'
import { useQueryStore, type QueryTab, PAGE_SIZE } from '../store-query'

type Val = string | null

const OPS: { v: FilterOp; label: string }[] = [
  { v: 'eq', label: '=' },
  { v: 'ne', label: '≠' },
  { v: 'lt', label: '<' },
  { v: 'gt', label: '>' },
  { v: 'le', label: '≤' },
  { v: 'ge', label: '≥' },
  { v: 'contains', label: 'contains' },
  { v: 'isNull', label: 'is null' },
  { v: 'isNotNull', label: 'is not null' }
]
const isNullOp = (op: FilterOp): boolean => op === 'isNull' || op === 'isNotNull'

export function TableDataGrid(props: { tab: QueryTab }): React.JSX.Element {
  const effectiveTheme = useThemeStore((s) => s.effective)
  // Theme derives from CSS vars; the effective theme keys the re-derive.
  const gridTheme = useMemo(() => dialectGlideTheme(liveStyleGetter()), [effectiveTheme])
  const { tab } = props
  const source = tab.source
  const data = tab.data
  const applyEdits = useQueryStore((s) => s.applyEdits)
  const setBrowse = useQueryStore((s) => s.setBrowse)
  const openFkTarget = useQueryStore((s) => s.openFkTarget)
  const { dialect } = useDialect()

  // Pending change set (component-local; cleared on apply/discard).
  const [edits, setEdits] = useState<Record<string, Val>>({}) // `${row}:${colName}` → new value
  const [inserts, setInserts] = useState<Record<string, Val>[]>([]) // one object per new row
  const [deletes, setDeletes] = useState<Set<number>>(new Set()) // existing source-row indices
  const [selection, setSelection] = useState<GridSelection>({
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty()
  })
  const [error, setError] = useState<string | null>(null)
  // Track the loaded row count in state so background paging triggers a
  // re-render (the source's row array grows mutably otherwise). Re-sync on
  // tab.status too: run() sets the source BEFORE awaiting the first page, so the
  // initial mount sees 0 rows — the status flip to 'done' is our signal the page
  // landed (same source instance, so a source-only dep would miss it).
  const [loadedCount, setLoadedCount] = useState(source?.loadedRowCount() ?? 0)
  useEffect(() => {
    setLoadedCount(source?.loadedRowCount() ?? 0)
  }, [source, tab.status])

  // Filter-bar draft rows (local; committed to the store on Apply).
  const [filterRows, setFilterRows] = useState<{ column: string; op: FilterOp; value: string }[]>(
    () =>
      data?.browse.filters.length
        ? data.browse.filters.map((f) => ({
            column: f.column,
            op: f.op,
            value: f.value == null ? '' : String(f.value)
          }))
        : [{ column: '', op: 'eq', value: '' }]
  )

  const editable = !!data && data.editable
  const fields = source?.fields ?? []
  const colName = (col: number): string => fields[col]?.name ?? ''
  const baseRows = loadedCount
  const totalRows = baseRows + inserts.length
  const dirty =
    Object.keys(edits).length +
    inserts.filter((r) => Object.keys(r).length > 0).length +
    deletes.size

  const fkColumns = data?.fkColumns ?? {}
  const sortFor = (name: string): Sort | undefined =>
    data?.browse.sort.find((s) => s.column === name)
  const columns = fields.map((f) => {
    const s = sortFor(f.name)
    return {
      title: f.name + (s ? (s.dir === 'asc' ? ' ↑' : ' ↓') : ''),
      id: f.name,
      width: 160
    }
  })

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell
      const name = colName(col)
      let value: Val
      let touched = false
      if (row < baseRows) {
        const key = `${row}:${name}`
        if (key in edits) {
          value = edits[key] ?? null
          touched = true
        } else {
          const raw = source?.getRow(row)?.[col]
          value = raw === null || raw === undefined ? null : String(raw)
        }
        if (deletes.has(row)) touched = true
      } else {
        value = inserts[row - baseRows]?.[name] ?? null
        touched = true
      }
      const text = value === null ? '∅' : value
      const isFk = name in fkColumns && value !== null
      const theme = {
        ...(touched ? { bgCell: '#3b3b1f' } : {}),
        ...(isFk ? { textDark: '#6ea8fe', textLight: '#0a58ca' } : {})
      }
      return {
        kind: GridCellKind.Text,
        data: value ?? '',
        displayData: text,
        allowOverlay: editable,
        ...(Object.keys(theme).length ? { themeOverride: theme } : {})
      }
    },
    [source, baseRows, edits, inserts, deletes, editable, fkColumns]
  )

  const onCellEdited = useCallback(
    (cell: Item, newVal: EditableGridCell): void => {
      if (newVal.kind !== GridCellKind.Text) return
      const [col, row] = cell
      const name = colName(col)
      const val = newVal.data
      if (row < baseRows) setEdits((e) => ({ ...e, [`${row}:${name}`]: val }))
      else
        setInserts((ins) => ins.map((r, i) => (i === row - baseRows ? { ...r, [name]: val } : r)))
    },
    [baseRows]
  )

  const onVisibleRegionChanged = useCallback(
    (range: { y: number; height: number }): void => {
      const need = range.y + range.height + 200
      if (source && !source.done() && need >= source.loadedRowCount())
        void source.ensureLoaded(need).then(() => setLoadedCount(source.loadedRowCount()))
    },
    [source]
  )

  function discard(): void {
    setEdits({})
    setInserts([])
    setDeletes(new Set())
    setError(null)
  }

  // Any browse change (filter/sort/FK-nav re-run) throws away in-flight edits —
  // confirm first, then clear pending so they don't reapply against new rows.
  function guardedSetBrowse(browse: { filters: Filter[]; sort: Sort[] }): void {
    if (dirty > 0) {
      if (!window.confirm(`Discard ${dirty} pending changes?`)) return
      discard()
    }
    setBrowse(tab.id, browse)
  }

  function applyFilters(): void {
    if (!data) return
    const filters: Filter[] = filterRows
      .filter((r) => r.column && (isNullOp(r.op) || r.value !== ''))
      .map((r) => (isNullOp(r.op) ? { column: r.column, op: r.op } : r))
    guardedSetBrowse({ filters, sort: data.browse.sort })
  }

  function onHeaderClicked(col: number): void {
    if (!data) return
    const name = colName(col)
    const cur = data.browse.sort.find((s) => s.column === name)
    // Cycle the clicked column asc → desc → unsorted (single-column sort in v1).
    const sort: Sort[] = !cur
      ? [{ column: name, dir: 'asc' }]
      : cur.dir === 'asc'
        ? [{ column: name, dir: 'desc' }]
        : []
    guardedSetBrowse({ filters: data.browse.filters, sort })
  }

  function onCellClicked(cell: Item): void {
    const [col, row] = cell
    if (!data || row >= baseRows) return
    const refTable = data.fkColumns[colName(col)]
    if (!refTable) return
    const raw = source?.getRow(row)?.[col]
    if (raw === null || raw === undefined) return
    void openFkTarget(data.schema, refTable, raw)
  }

  function setNull(): void {
    const c = selection.current?.cell
    if (!c) return
    const [col, row] = c
    const name = colName(col)
    if (row < baseRows) setEdits((e) => ({ ...e, [`${row}:${name}`]: null }))
    else setInserts((ins) => ins.map((r, i) => (i === row - baseRows ? { ...r, [name]: null } : r)))
  }

  function toggleDeleteSelected(): void {
    const rows = selection.rows.toArray().filter((r) => r < baseRows)
    setDeletes((d) => {
      const next = new Set(d)
      for (const r of rows) {
        if (next.has(r)) next.delete(r)
        else next.add(r)
      }
      return next
    })
  }

  function toPending(): PendingEdits {
    if (!data) return { schema: '', table: '', updates: [], inserts: [], deletes: [] }
    const pkCells = (row: number): Cell[] =>
      data.pkColumns.map((name) => {
        const idx = fields.findIndex((f) => f.name === name)
        const raw = source?.getRow(row)?.[idx]
        return { column: name, value: raw === undefined ? null : raw }
      })
    // Group edited cells by row (skip rows marked for deletion — delete wins).
    const byRow = new Map<number, Cell[]>()
    for (const key of Object.keys(edits)) {
      const [rowStr, name] = key.split(':')
      const row = Number(rowStr)
      if (deletes.has(row)) continue
      const list = byRow.get(row) ?? []
      list.push({ column: name!, value: edits[key] ?? null })
      byRow.set(row, list)
    }
    return {
      schema: data.schema,
      table: data.table,
      updates: [...byRow.entries()].map(([row, set]) => ({ pk: pkCells(row), set })),
      inserts: inserts
        .filter((r) => Object.keys(r).length > 0)
        .map((r) => ({ values: Object.entries(r).map(([column, value]) => ({ column, value })) })),
      deletes: [...deletes].map((row) => ({ pk: pkCells(row) }))
    }
  }

  async function review(): Promise<void> {
    setError(null)
    const list = buildEdits(toPending())
    if (list.length === 0) return
    const ok = window.confirm(`Apply these changes?\n\n${previewEdits(list).join(';\n')}`)
    if (!ok) return
    try {
      await applyEdits(tab.id, list)
      setEdits({})
      setInserts([])
      setDeletes(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // Surface a browse failure (e.g. "Browsing is not supported by this engine"
  // for a Mongo collection opened via the relational "Open data" path, or any
  // other openBrowse rejection) instead of silently falling through to the
  // empty "No data." state below.
  if (tab.status === 'error')
    return (
      <div className="p-4">
        <div className="rounded bg-destructive/10 p-2 text-sm text-destructive">
          {tab.message ?? 'Failed to load data.'}
        </div>
      </div>
    )

  if (!source || columns.length === 0)
    return <div className="p-4 text-muted-foreground">No data.</div>

  const browseSqlLine = data
    ? buildBrowseSql(
        {
          schema: data.schema,
          table: data.table,
          filters: data.browse.filters,
          sort: data.browse.sort,
          // The real page size the store browses with — buildBrowseSql doesn't
          // emit LIMIT today, but a fake value here becomes a lie if it ever does.
          pageSize: PAGE_SIZE
        },
        dialect
      ).sql.replace(/\s+/g, ' ')
    : null

  return (
    <div className="relative flex h-full flex-col">
      {/* Compact query bar (Dialect): documents the SQL the grid is showing. */}
      {browseSqlLine && (
        <div className="flex flex-none items-center gap-2 border-b border-border-soft bg-surface-1 px-2 py-1">
          <span className="flex-none rounded bg-primary/10 px-1 text-[10px] font-semibold uppercase text-primary">
            SQL
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {browseSqlLine}
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-border p-1 text-sm">
        {editable ? (
          <>
            <button
              className="rounded px-2 py-0.5 hover:bg-muted"
              onClick={() => setInserts((i) => [...i, {}])}
            >
              + Row
            </button>
            <button className="rounded px-2 py-0.5 hover:bg-muted" onClick={toggleDeleteSelected}>
              Delete row
            </button>
            <button className="rounded px-2 py-0.5 hover:bg-muted" onClick={setNull}>
              Set NULL
            </button>
          </>
        ) : (
          <span className="text-muted-foreground">No primary key — read only</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b border-border p-1 text-xs">
        {filterRows.map((r, i) => (
          <div key={i} className="flex items-center gap-1">
            <select
              aria-label="filter-column"
              className="rounded border border-border bg-background px-1 py-0.5"
              value={r.column}
              onChange={(e) =>
                setFilterRows((rows) =>
                  rows.map((x, j) => (j === i ? { ...x, column: e.target.value } : x))
                )
              }
            >
              <option value="">column…</option>
              {fields.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </select>
            <select
              aria-label="filter-op"
              className="rounded border border-border bg-background px-1 py-0.5"
              value={r.op}
              onChange={(e) =>
                setFilterRows((rows) =>
                  rows.map((x, j) => (j === i ? { ...x, op: e.target.value as FilterOp } : x))
                )
              }
            >
              {OPS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              aria-label="filter-value"
              className="w-28 rounded border border-border bg-background px-1 py-0.5 disabled:opacity-40"
              disabled={isNullOp(r.op)}
              value={r.value}
              onChange={(e) =>
                setFilterRows((rows) =>
                  rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x))
                )
              }
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
            <button
              className="rounded px-1 hover:bg-muted"
              aria-label="remove-filter"
              onClick={() =>
                setFilterRows((rows) =>
                  rows.length > 1
                    ? rows.filter((_, j) => j !== i)
                    : [{ column: '', op: 'eq', value: '' }]
                )
              }
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="rounded px-2 py-0.5 hover:bg-muted"
          onClick={() => setFilterRows((rows) => [...rows, { column: '', op: 'eq', value: '' }])}
        >
          + filter
        </button>
        <button
          className="rounded bg-primary px-2 py-0.5 text-primary-foreground"
          onClick={applyFilters}
        >
          Apply
        </button>
        <span className="ml-2 text-muted-foreground">
          click a header to sort · click a linked value to follow the FK
        </span>
      </div>
      {error && <div className="p-1 text-sm text-destructive">{error}</div>}
      <div className="min-h-0 flex-1">
        <DataEditor
          theme={gridTheme}
          columns={columns}
          rows={totalRows}
          getCellContent={getCellContent}
          onCellEdited={onCellEdited}
          onHeaderClicked={onHeaderClicked}
          onCellClicked={onCellClicked}
          onVisibleRegionChanged={onVisibleRegionChanged}
          gridSelection={selection}
          onGridSelectionChange={setSelection}
          rowMarkers="both"
          smoothScrollX
          smoothScrollY
          width="100%"
          height="100%"
        />
      </div>
      {/* Pending-changes tray (Dialect): floats over the grid bottom. Always
          mounted for editable tabs so the apply affordance is discoverable
          (and e2e-visible) even at 0 pending. */}
      {editable && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
          <div
            className="pointer-events-auto flex max-w-[92%] items-center gap-3 rounded-xl px-3 py-2 text-xs text-chrome-foreground shadow-[var(--shadow-pop)]"
            style={{ background: 'linear-gradient(180deg, var(--chrome), var(--chrome-2))' }}
          >
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span
                className={`h-1.5 w-1.5 rounded-full ${dirty > 0 ? 'bg-warning' : 'bg-success'}`}
              />
              {dirty} pending
            </span>
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
              {dirty > 0 &&
                previewEdits(buildEdits(toPending()))
                  .slice(0, 3)
                  .map((sql, i) => (
                    <span
                      key={i}
                      className="whitespace-nowrap rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-chrome-foreground/80"
                    >
                      {sql.length > 60 ? `${sql.slice(0, 60)}…` : sql}
                    </span>
                  ))}
            </div>
            <button
              className="rounded px-2 py-1 text-chrome-foreground/80 hover:bg-white/10 disabled:opacity-40"
              disabled={dirty === 0}
              onClick={discard}
            >
              Discard
            </button>
            <button
              className="whitespace-nowrap rounded bg-primary px-2.5 py-1 font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
              disabled={dirty === 0}
              onClick={() => void review()}
            >
              Review &amp; apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

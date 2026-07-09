import { useCallback, useEffect, useState } from 'react'
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
import { useQueryStore, type QueryTab } from '../store-query'

type Val = string | null

export function TableDataGrid(props: { tab: QueryTab }): React.JSX.Element {
  const { tab } = props
  const source = tab.source
  const data = tab.data
  const applyEdits = useQueryStore((s) => s.applyEdits)

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
  // re-render (the source's row array grows mutably otherwise).
  const [loadedCount, setLoadedCount] = useState(source?.loadedRowCount() ?? 0)
  useEffect(() => {
    setLoadedCount(source?.loadedRowCount() ?? 0)
  }, [source])

  const editable = !!data && data.editable
  const fields = source?.fields ?? []
  const colName = (col: number): string => fields[col]?.name ?? ''
  const baseRows = loadedCount
  const totalRows = baseRows + inserts.length
  const dirty =
    Object.keys(edits).length +
    inserts.filter((r) => Object.keys(r).length > 0).length +
    deletes.size

  const columns = fields.map((f) => ({ title: f.name, id: f.name, width: 160 }))

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
      return {
        kind: GridCellKind.Text,
        data: value ?? '',
        displayData: text,
        allowOverlay: editable,
        ...(touched ? { themeOverride: { bgCell: '#3b3b1f' } } : {})
      }
    },
    [source, baseRows, edits, inserts, deletes, editable]
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

  function discard(): void {
    setEdits({})
    setInserts([])
    setDeletes(new Set())
    setError(null)
  }

  if (!source || columns.length === 0)
    return <div className="p-4 text-muted-foreground">No data.</div>

  return (
    <div className="flex h-full flex-col">
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
            <span className="ml-auto text-muted-foreground">{dirty} pending</span>
            <button
              className="rounded bg-primary px-2 py-0.5 text-primary-foreground disabled:opacity-50"
              disabled={dirty === 0}
              onClick={() => void review()}
            >
              Review &amp; apply
            </button>
            <button
              className="rounded px-2 py-0.5 hover:bg-muted disabled:opacity-50"
              disabled={dirty === 0}
              onClick={discard}
            >
              Discard
            </button>
          </>
        ) : (
          <span className="text-muted-foreground">No primary key — read only</span>
        )}
      </div>
      {error && <div className="p-1 text-sm text-destructive">{error}</div>}
      <div className="min-h-0 flex-1">
        <DataEditor
          columns={columns}
          rows={totalRows}
          getCellContent={getCellContent}
          onCellEdited={onCellEdited}
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
    </div>
  )
}

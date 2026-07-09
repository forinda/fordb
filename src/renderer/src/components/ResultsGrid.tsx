import { useCallback, useEffect, useState } from 'react'
import { DataEditor, GridCellKind, type GridCell, type Item } from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import type { QueryResultSource } from '@shared/query/result-source'

export function ResultsGrid(props: { source: QueryResultSource }): React.JSX.Element {
  const { source } = props
  const [rowCount, setRowCount] = useState(source.loadedRowCount())

  useEffect(() => {
    setRowCount(source.loadedRowCount())
  }, [source])

  const columns = source.fields.map((f) => ({ title: f.name, id: f.name, width: 160 }))

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell
      const r = source.getRow(row)
      const v = r?.[col]
      const text = v === null || v === undefined ? '' : String(v)
      return { kind: GridCellKind.Text, data: text, displayData: text, allowOverlay: false }
    },
    [source]
  )

  // Load more as the grid asks for rows near the loaded edge.
  const onVisibleRegionChanged = useCallback(
    (range: { y: number; height: number }): void => {
      const need = range.y + range.height + 200
      if (!source.done() && need >= source.loadedRowCount()) {
        void source.ensureLoaded(need).then(() => setRowCount(source.loadedRowCount()))
      }
    },
    [source]
  )

  if (columns.length === 0) return <div className="p-4 text-muted-foreground">No result set.</div>
  return (
    <DataEditor
      columns={columns}
      rows={rowCount}
      getCellContent={getCellContent}
      onVisibleRegionChanged={onVisibleRegionChanged}
      rowMarkers="number"
      smoothScrollX
      smoothScrollY
      getCellsForSelection
      width="100%"
      height="100%"
    />
  )
}

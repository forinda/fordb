import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

// One series set: data[0] = x (seconds), data[1..] = y series aligned to labels.
export interface TimeSeriesChartProps {
  data: number[][]
  labels: string[]
  title: string
  format?: (v: number) => string
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function TimeSeriesChart(props: TimeSeriesChartProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<uPlot | null>(null)

  // Create once; the effect below feeds data. Recreate only if the series
  // shape (labels) changes.
  useEffect(() => {
    if (!host.current) return
    const stroke = cssVar('--color-primary', '#3b82f6')
    const axis = cssVar('--color-muted-foreground', '#888')
    const grid = cssVar('--color-border', '#333')
    const palette = [stroke, '#f59e0b', '#10b981', '#ef4444']
    const opts: uPlot.Options = {
      title: props.title,
      width: host.current.clientWidth || 300,
      height: 140,
      cursor: { show: true },
      legend: { show: true },
      scales: { x: { time: false } },
      axes: [
        { stroke: axis, grid: { stroke: grid }, ticks: { stroke: grid } },
        {
          stroke: axis,
          grid: { stroke: grid },
          ticks: { stroke: grid },
          values: props.format ? (_u, ticks) => ticks.map((t) => props.format!(t)) : undefined
        }
      ],
      series: [
        {},
        ...props.labels.map((label, i) => ({ label, stroke: palette[i % palette.length] }))
      ]
    }
    const u = new uPlot(opts, props.data as uPlot.AlignedData, host.current)
    chart.current = u
    const ro = new ResizeObserver(() => {
      if (host.current) u.setSize({ width: host.current.clientWidth, height: 140 })
    })
    ro.observe(host.current)
    return () => {
      ro.disconnect()
      u.destroy()
      chart.current = null
    }
    // Recreate when the series identity changes (label set / title).
  }, [props.labels.join('|'), props.title])

  // Feed new data without recreating the chart.
  useEffect(() => {
    chart.current?.setData(props.data as uPlot.AlignedData)
  }, [props.data])

  return <div ref={host} className="w-full" />
}

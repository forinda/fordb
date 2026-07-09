import IconPause from '~icons/lucide/pause'
import IconPlay from '~icons/lucide/play'
import { Button } from '../ui/button'

const INTERVALS = [1000, 2000, 5000, 10000]

export function ControlsBar(props: {
  intervalMs: number
  onIntervalChange: (ms: number) => void
  paused: boolean
  onTogglePause: () => void
  fullVisibility: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-border p-2 text-sm">
      <Button variant="ghost" size="sm" onClick={props.onTogglePause}>
        <span className="flex items-center gap-1">
          {props.paused ? (
            <IconPlay className="h-3.5 w-3.5" />
          ) : (
            <IconPause className="h-3.5 w-3.5" />
          )}
          {props.paused ? 'Resume' : 'Pause'}
        </span>
      </Button>
      <label className="flex items-center gap-1 text-muted-foreground">
        Refresh
        <select
          className="rounded border border-border bg-background px-1 py-0.5 text-foreground"
          value={props.intervalMs}
          onChange={(e) => props.onIntervalChange(Number(e.target.value))}
        >
          {INTERVALS.map((ms) => (
            <option key={ms} value={ms}>
              {ms / 1000}s
            </option>
          ))}
        </select>
      </label>
      {!props.fullVisibility && (
        <span className="ml-auto text-xs text-muted-foreground">
          limited visibility — grant pg_monitor for full stats
        </span>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import IconMinus from '~icons/lucide/minus'
import IconSquare from '~icons/lucide/square'
import IconCopy from '~icons/lucide/copy'
import IconX from '~icons/lucide/x'
import { controlMode } from '@shared/window-controls'
import { connectionLabel } from '@shared/connection-label'
import { useProfiles } from '../query/profiles'
import { useConnStore } from '../store'

// The bar is the drag region; every interactive child opts out via no-drag.
const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

function ControlButton(props: {
  label: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      aria-label={props.label}
      title={props.label}
      style={noDrag}
      onClick={props.onClick}
      className={`flex h-11 w-[46px] items-center justify-center text-chrome-foreground/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        props.danger
          ? 'hover:bg-destructive hover:text-destructive-foreground'
          : 'hover:bg-white/10 hover:text-chrome-foreground'
      }`}
    >
      {props.children}
    </button>
  )
}

/** Dialect title bar: 44px navy gradient, draggable, app name + active
 *  connection; custom min/max/close off-macOS (mac shows native traffic
 *  lights via titleBarStyle:'hiddenInset', so we only pad past them). */
export function TitleBar(): React.JSX.Element {
  const platform = window.fordb.platform
  const custom = controlMode(platform) === 'custom'
  const [maximized, setMaximized] = useState(false)
  const activeProfileId = useConnStore((s) => s.activeProfileId)
  const { data: profiles = [] } = useProfiles()
  const profile = profiles.find((p) => p.id === activeProfileId)

  useEffect(() => {
    void window.fordb.windowControls.isMaximized().then(setMaximized)
    window.fordb.windowControls.onMaximizeChanged(setMaximized)
  }, [])

  return (
    <div
      style={{ ...drag, background: 'linear-gradient(180deg, var(--chrome), var(--chrome-2))' }}
      className="flex h-11 flex-none items-center border-b border-black/35 text-chrome-foreground"
    >
      {/* macOS native traffic-lights occupy the left inset. */}
      {platform === 'darwin' && <div className="w-[70px] flex-none" />}
      <div className="flex min-w-0 flex-1 items-center gap-3 px-4">
        <span className="text-sm font-semibold tracking-wide">fordb</span>
        {profile && (
          <span className="truncate text-xs text-chrome-foreground/60">
            {connectionLabel(profile)}
          </span>
        )}
      </div>
      {custom && (
        <div className="flex flex-none items-stretch">
          <ControlButton label="Minimize" onClick={() => window.fordb.windowControls.minimize()}>
            <IconMinus className="h-4 w-4" />
          </ControlButton>
          <ControlButton
            label={maximized ? 'Restore' : 'Maximize'}
            onClick={() => window.fordb.windowControls.maximize()}
          >
            {maximized ? (
              <IconCopy className="h-3.5 w-3.5" />
            ) : (
              <IconSquare className="h-3.5 w-3.5" />
            )}
          </ControlButton>
          <ControlButton label="Close" danger onClick={() => window.fordb.windowControls.close()}>
            <IconX className="h-4 w-4" />
          </ControlButton>
        </div>
      )}
    </div>
  )
}

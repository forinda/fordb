import { useEffect, useState } from 'react'
import IconMinus from '~icons/lucide/minus'
import IconSquare from '~icons/lucide/square'
import IconCopy from '~icons/lucide/copy'
import IconX from '~icons/lucide/x'
import IconDatabase from '~icons/lucide/database'
import IconTerminal from '~icons/lucide/terminal'
import IconPanelLeft from '~icons/lucide/panel-left'
import { controlMode } from '@shared/window-controls'
import { connectionLabel } from '@shared/connection-label'
import { useProfiles } from '../query/profiles'
import { useConnStore } from '../store'

// The bar is the drag region; every interactive child opts out via no-drag.
const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

const ENV_DOT: Record<string, string> = {
  production: 'bg-warning',
  staging: 'bg-info',
  local: 'bg-success'
}

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
      className={`flex h-9 w-[42px] items-center justify-center text-chrome-foreground/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        props.danger
          ? 'hover:bg-destructive hover:text-destructive-foreground'
          : 'hover:bg-white/10 hover:text-chrome-foreground'
      }`}
    >
      {props.children}
    </button>
  )
}

/** Dialect title bar: 44px navy gradient, draggable. Left: the Connections /
 *  Editor screen toggle (segmented pills per the mockup). Center: the current
 *  connection (env dot + label + engine). Right: custom window controls
 *  off-macOS (mac shows native traffic lights via titleBarStyle:'hiddenInset'). */
export function TitleBar(props: {
  screen: 'connections' | 'editor'
  onScreenChange: (screen: 'connections' | 'editor') => void
  editorEnabled: boolean
  /** Editor-screen sidebar collapse toggle (panels get out of the way). */
  onToggleSidebar?: () => void
  sidebarVisible?: boolean
}): React.JSX.Element {
  const platform = window.fordb.platform
  const custom = controlMode(platform) === 'custom'
  const [maximized, setMaximized] = useState(false)
  const activeProfileId = useConnStore((s) => s.activeProfileId)
  const { data: profiles = [] } = useProfiles()
  const profile = profiles.find((p) => p.id === activeProfileId)

  useEffect(() => {
    void window.fordb.windowControls.isMaximized().then(setMaximized)
    return window.fordb.windowControls.onMaximizeChanged(setMaximized)
  }, [])

  const tabs = [
    { id: 'connections' as const, label: 'Connections', icon: IconDatabase, enabled: true },
    { id: 'editor' as const, label: 'Editor', icon: IconTerminal, enabled: props.editorEnabled }
  ]

  return (
    <div
      style={{ ...drag, background: 'linear-gradient(180deg, var(--chrome), var(--chrome-2))' }}
      className="flex h-9 flex-none items-center gap-3 border-b border-black/35 px-3 text-chrome-foreground"
    >
      {/* macOS: native traffic-lights occupy the left inset. Elsewhere: the
          Dialect decorative dots (real controls live on the right). */}
      {platform === 'darwin' ? (
        <div className="w-[70px] flex-none" />
      ) : (
        <div className="flex flex-none items-center gap-2" aria-hidden="true">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
      )}

      {/* Screen toggle (segmented pills). */}
      <div
        style={noDrag}
        className="flex flex-none rounded-lg border border-white/10 bg-white/5 p-0.5"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            disabled={!t.enabled}
            aria-pressed={props.screen === t.id}
            onClick={() => props.onScreenChange(t.id)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-0.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 ${
              props.screen === t.id
                ? 'bg-primary text-primary-foreground'
                : 'text-chrome-foreground/70 hover:text-chrome-foreground'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {props.onToggleSidebar && props.screen === 'editor' && (
        <button
          style={noDrag}
          aria-label="Toggle sidebar"
          aria-pressed={props.sidebarVisible}
          title="Toggle sidebar"
          onClick={props.onToggleSidebar}
          className={`rounded p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            props.sidebarVisible ? 'text-chrome-foreground/80' : 'text-chrome-foreground/40'
          } hover:bg-white/10`}
        >
          <IconPanelLeft className="h-4 w-4" />
        </button>
      )}

      {/* Current connection, centered. */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-xs font-semibold tracking-wide">
        {profile ? (
          <>
            <span
              className={`h-[7px] w-[7px] flex-none rounded-full shadow-[0_0_0_3px_rgba(255,255,255,0.06)] ${
                ENV_DOT[profile.environment ?? ''] ?? 'bg-faint'
              }`}
            />
            <span className="truncate text-chrome-foreground/90">{connectionLabel(profile)}</span>
            <span className="flex-none uppercase text-chrome-foreground/50">{profile.engine}</span>
          </>
        ) : (
          <span className="text-chrome-foreground/50">fordb</span>
        )}
      </div>

      {custom && (
        <div className="-mr-3 flex flex-none items-stretch">
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

export type Platform = 'darwin' | 'win32' | 'linux'

/** macOS shows native traffic-lights via titleBarStyle:'hiddenInset'; every
 *  other platform renders our own min/max/close buttons in the TitleBar. */
export function controlMode(platform: Platform): 'native' | 'custom' {
  return platform === 'darwin' ? 'native' : 'custom'
}

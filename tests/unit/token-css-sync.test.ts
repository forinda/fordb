import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOKENS, type TokenSet } from '../../src/shared/theme-tokens'

// The runtime truth is index.css; the contrast test guards theme-tokens.ts.
// This test ties them together so the two hand-maintained copies can't drift
// (an edit to one without the other would ship unaudited colors).

const css = readFileSync(join(__dirname, '../../src/renderer/src/index.css'), 'utf8')

// CSS var name → TokenSet key.
const VARS: Record<string, keyof TokenSet> = {
  '--background': 'background',
  '--foreground': 'foreground',
  '--muted': 'muted',
  '--muted-foreground': 'mutedForeground',
  '--card': 'card',
  '--border': 'border',
  '--primary': 'primary',
  '--primary-foreground': 'primaryForeground',
  '--destructive': 'destructive',
  '--destructive-foreground': 'destructiveForeground',
  '--ring': 'ring'
}

function block(selector: string): string {
  // Match the actual rule (`selector {`), not an incidental mention like the
  // `@custom-variant dark (&:where(.dark, .dark *))` line.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const open = new RegExp(`${escaped}\\s*\\{`).exec(css)
  if (!open) throw new Error(`rule ${selector} not found`)
  const from = open.index + open[0].length
  const close = css.indexOf('}', from)
  return css.slice(from, close)
}

function readVars(selector: string): Record<string, string> {
  const body = block(selector)
  const out: Record<string, string> = {}
  for (const line of body.split('\n')) {
    const m = line.match(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6});/)
    if (m) out[m[1]!] = m[2]!.toLowerCase()
  }
  return out
}

describe('index.css tokens match theme-tokens.ts', () => {
  const cases: [string, TokenSet][] = [
    [':root', TOKENS.light],
    ['.dark', TOKENS.dark]
  ]
  for (const [selector, tokens] of cases) {
    it(`${selector} matches TOKENS`, () => {
      const vars = readVars(selector)
      for (const [cssVar, key] of Object.entries(VARS)) {
        expect(vars[cssVar], `${selector} ${cssVar}`).toBe(tokens[key].toLowerCase())
      }
    })
  }
})

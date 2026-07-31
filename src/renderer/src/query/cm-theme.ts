import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

// Map CodeMirror surfaces to the app's CSS token variables so the editor
// follows light/dark automatically (the .dark class flips the vars).
//
// Specificity matters here. @codemirror/view's baseTheme styles the selection
// via `&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`
// — five classes. A plain `.cm-selectionBackground` rule loses to it no matter
// what order the extensions are in, which is why the selection used to render
// as CodeMirror's default pale lavender (#d7d4f0) behind near-white dark-mode
// text. The selection/cursor rules below mirror the base selectors exactly.
//
// The tooltip and panel surfaces need styling for the same reason: left alone
// they keep CodeMirror's light defaults (#f5f5f5) while inheriting the editor's
// foreground colour, so in dark mode the autocomplete list was near-white text
// on a near-white background.
export const cmTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--background)', color: 'var(--foreground)', height: '100%' },
  '.cm-gutters': {
    backgroundColor: 'var(--muted)',
    color: 'var(--muted-foreground)',
    border: 'none'
  },
  '.cm-activeLine': { backgroundColor: 'var(--muted)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--muted)' },

  // Selection. Translucent primary reads on either theme and keeps the syntax
  // colours underneath legible, unlike an opaque fill.
  '.cm-selectionLayer .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--primary) 32%, transparent)'
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--primary) 55%, transparent)'
  },

  // Cursor. drawSelection() hides the native caret (caret-color: transparent)
  // and draws its own element, so styling `.cm-content { caretColor }` did
  // nothing — the drawn cursor kept its default black and vanished on the dark
  // background.
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused > .cm-scroller > .cm-cursorLayer .cm-cursor': {
    borderLeftColor: 'var(--foreground)'
  },

  // Autocomplete + hover tooltips.
  '.cm-tooltip': {
    backgroundColor: 'var(--surface-1)',
    color: 'var(--foreground)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)'
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'inherit',
    maxHeight: '16rem'
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    color: 'var(--foreground)',
    padding: '2px 6px'
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--primary)',
    color: 'var(--primary-foreground)'
  },
  '.cm-completionLabel': { color: 'inherit' },
  '.cm-completionDetail': { color: 'var(--muted-foreground)', fontStyle: 'italic' },
  '.cm-completionMatchedText': {
    textDecoration: 'none',
    fontWeight: '700',
    color: 'inherit'
  },

  // Search / goto-line panels (basicSetup ships them; same light defaults).
  '.cm-panels': { backgroundColor: 'var(--surface-1)', color: 'var(--foreground)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel input, .cm-panel button': {
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)'
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--warning) 35%, transparent)'
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--warning) 60%, transparent)'
  }
})

// Syntax colors don't come from CSS vars — they're baked into a HighlightStyle.
// Two palettes (light/dark) so keywords/strings/comments stay legible on either
// background; swapped via a compartment on theme change (see SqlEditor).
const lightHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#7c3aed' },
  { tag: [t.string, t.special(t.string)], color: '#16a34a' },
  { tag: t.comment, color: '#6b7280', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null], color: '#c2410c' },
  { tag: [t.function(t.variableName), t.labelName], color: '#2563eb' },
  { tag: t.operator, color: '#0f766e' }
])
const darkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#c4b5fd' },
  { tag: [t.string, t.special(t.string)], color: '#86efac' },
  { tag: t.comment, color: '#9ca3af', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null], color: '#fdba74' },
  { tag: [t.function(t.variableName), t.labelName], color: '#93c5fd' },
  { tag: t.operator, color: '#5eead4' }
])

export function editorHighlight(mode: 'light' | 'dark'): Extension {
  return syntaxHighlighting(mode === 'dark' ? darkHighlight : lightHighlight)
}

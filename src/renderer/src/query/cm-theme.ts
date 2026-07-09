import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

// Map CodeMirror surfaces to the app's CSS token variables so the editor
// follows light/dark automatically (the .dark class flips the vars).
export const cmTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--background)', color: 'var(--foreground)', height: '100%' },
  '.cm-content': { caretColor: 'var(--foreground)' },
  '.cm-gutters': {
    backgroundColor: 'var(--muted)',
    color: 'var(--muted-foreground)',
    border: 'none'
  },
  '.cm-activeLine': { backgroundColor: 'var(--muted)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--muted)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--muted)'
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

import { EditorView } from '@codemirror/view'

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

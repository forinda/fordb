import { useEffect, useState } from 'react'
import { Modal } from './ui/modal'

/** Edit a function/trigger (or any object) as raw SQL — pre-filled with its
 *  current definition or a template. Apply hands the SQL to the caller, which
 *  runs it through the DDL apply path. */
export function ObjectEditorDialog(props: {
  open: boolean
  onClose: () => void
  title: string
  initialSql: string
  onApply: (sql: string) => void
}): React.JSX.Element {
  const [sql, setSql] = useState(props.initialSql)
  useEffect(() => {
    if (props.open) setSql(props.initialSql)
  }, [props.open, props.initialSql])

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.title}
      footer={
        <>
          <button
            className="rounded border border-border px-3 py-1 text-sm hover:bg-muted"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            className="rounded bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
            disabled={!sql.trim()}
            onClick={() => props.onApply(sql)}
          >
            Apply
          </button>
        </>
      }
    >
      <textarea
        className="h-[55vh] w-full resize-none rounded border border-border bg-surface-2 p-3 font-mono text-xs"
        spellCheck={false}
        value={sql}
        onChange={(e) => setSql(e.target.value)}
      />
    </Modal>
  )
}

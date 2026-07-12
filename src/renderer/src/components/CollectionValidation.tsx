import { useEffect, useState } from 'react'
import { hostApi } from '../rpc'
import { Modal } from './ui/modal'

const EXAMPLE = `{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["name"],
    "properties": {
      "name": { "bsonType": "string" }
    }
  }
}`

/** View/edit a MongoDB collection's schema-validation rule (collMod validator).
 *  `db` is the Mongo database (tree "schema"); `coll` the collection. */
export function CollectionValidation(props: {
  connId: string
  db: string
  coll: string
  onClose: () => void
}): React.JSX.Element {
  const { connId, db, coll } = props
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const v = await (await hostApi()).getValidator(connId, db, coll)
        if (live) setText(v ? JSON.stringify(v, null, 2) : '')
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (live) setBusy(false)
      }
    })()
    return () => {
      live = false
    }
  }, [connId, db, coll])

  async function run(validator: Record<string, unknown> | null): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await (await hostApi()).setValidator(connId, db, coll, validator)
      props.onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  function save(): void {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(text) as Record<string, unknown>
    } catch {
      setError('Validator is not valid JSON')
      return
    }
    void run(parsed)
  }

  return (
    <Modal
      open
      onClose={props.onClose}
      title={`Validation — ${db}.${coll}`}
      footer={
        <>
          <button
            className="rounded border border-border px-3 py-1 text-sm text-destructive hover:bg-muted disabled:opacity-50"
            disabled={busy}
            onClick={() => void run(null)}
          >
            Clear rule
          </button>
          <button
            className="rounded border border-border px-3 py-1 text-sm hover:bg-muted"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            className="rounded bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            disabled={busy || !text.trim()}
            onClick={save}
          >
            Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        {error && <div className="rounded bg-destructive/10 p-2 text-destructive">{error}</div>}
        <div className="text-xs text-muted-foreground">
          JSON validator (e.g. a <span className="font-mono">$jsonSchema</span>). Empty = no rule.
        </div>
        <textarea
          className="h-64 w-full rounded border border-border bg-background p-2 font-mono text-xs"
          placeholder={EXAMPLE}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
      </div>
    </Modal>
  )
}

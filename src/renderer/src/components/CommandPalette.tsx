import { useEffect, useState } from 'react'

interface Command {
  id: string
  label: string
  run: () => void
}

export function CommandPalette(props: { commands: Command[] }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!open) return null
  const filtered = props.commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()))
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center pt-32"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-neutral-900 border border-neutral-600 rounded w-96 text-neutral-100"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          className="w-full px-3 py-2 bg-transparent text-neutral-100 placeholder-neutral-400 outline-none"
          placeholder="Command…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="max-h-64 overflow-auto">
          {filtered.map((c) => (
            <button
              key={c.id}
              className="block w-full text-left px-3 py-2 text-neutral-100 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none"
              onClick={() => {
                setOpen(false)
                c.run()
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

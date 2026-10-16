import { useEffect, useRef, useState } from 'react'
import type { InstalledModel } from '../ai/ollama'

interface Props {
  installed: InstalledModel[] | null | 'checking'
  modelId: string
  dot: 'ok' | 'warn' | 'idle'
  disabled: boolean
  onChoose: (id: string) => void
  onManage: () => void
  /** Which way the menu opens: below the button or above it (when the picker sits at the bottom of the page). */
  placement?: 'down' | 'up'
}

/** A themed model dropdown (the browser's own <select> popup ignores dark mode). */
export function ModelPicker({ installed, modelId, dot, disabled, onChoose, onManage, placement = 'down' }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const list = Array.isArray(installed) ? installed : []
  const known = list.some((m) => m.name === modelId)

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = modelId
  const choose = (id: string) => {
    setOpen(false)
    if (id !== modelId) onChoose(id)
  }

  return (
    <div className="model-pick" ref={root}>
      <button
        type="button"
        className="model-trigger"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Model: ${current}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`dot ${dot}`} />
        <span className="model-current">{current}</span>
        <svg className={`chevron${open ? ' up' : ''}`} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className={`model-menu ${placement}`} role="menu">
          <p className="menu-title">AI model</p>

          {installed === 'checking' && <p className="menu-note">Checking Ollama…</p>}
          {installed === null && <p className="menu-note warn">Ollama is not running. Start it to use a model.</p>}

          {list.map((m) => (
            <button key={m.name} type="button" role="menuitemradio" aria-checked={m.name === modelId} className={`model-item${m.name === modelId ? ' active' : ''}`} onClick={() => choose(m.name)}>
              <span className="item-main">
                <span className="item-name">{m.name}</span>
                <span className="item-meta">
                  {m.sizeGB.toFixed(1)} GB · {m.tools ? 'tools' : 'no tools'}
                  {m.thinking ? ' · thinking' : ''}
                </span>
              </span>
              {m.name === modelId && <span className="check">✓</span>}
            </button>
          ))}

          {!known && installed !== 'checking' && (
            <div className="model-item missing" role="menuitem" aria-disabled="true">
              <span className="item-main">
                <span className="item-name">{modelId}</span>
                <span className="item-meta">not installed - run: ollama pull {modelId}</span>
              </span>
            </div>
          )}


          <button
            type="button"
            className="menu-manage"
            onClick={() => {
              setOpen(false)
              onManage()
            }}
          >
            Manage models…
          </button>
        </div>
      )}
    </div>
  )
}

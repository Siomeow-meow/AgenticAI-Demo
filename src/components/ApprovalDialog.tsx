import { useEffect, useRef } from 'react'
import type { ApprovalAnswer, ApprovalRequest } from '../ai/approval'

/** Asks before the assistant does something that changes anything outside the chat. */
export function ApprovalDialog({ request, onAnswer }: { request: ApprovalRequest; onAnswer: (answer: ApprovalAnswer) => void }) {
  const denyRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    denyRef.current?.focus() // the safe choice is the one a stray Enter press picks
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onAnswer('deny')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onAnswer])

  const entries = Object.entries(request.args)

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="approval-title">
        <h2 id="approval-title">Allow this action?</h2>
        <p className="modal-summary">
          <code>{request.tool}</code>: {request.summary}
        </p>
        {request.warning && <p className="banner warn">{request.warning}</p>}
        {entries.length > 0 && (
          <details>
            <summary>Details</summary>
            <pre>{entries.map(([k, v]) => `${k}: ${v.length > 400 ? `${v.slice(0, 400)}…` : v}`).join('\n')}</pre>
          </details>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" ref={denyRef} onClick={() => onAnswer('deny')}>
            Deny
          </button>
          <button type="button" className="btn primary" onClick={() => onAnswer('once')}>
            Allow once
          </button>
          {!request.warning && (
            <button type="button" className="btn" onClick={() => onAnswer('always')} title="Stop asking for this tool until you close the app">
              Always allow
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

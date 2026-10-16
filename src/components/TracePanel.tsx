import { useEffect, useRef } from 'react'
import type { TraceEvent } from '../ai/hosted'

const LABELS: Record<TraceEvent['type'], string> = {
  llm_call: 'MODEL',
  tool_call: 'TOOL CALL',
  tool_result: 'RESULT',
  retrieval: 'RETRIEVAL',
  image_attached: 'IMAGE',
  error: 'ERROR',
}

/** One line that says what a result was, so the panel reads without opening the JSON. */
function summarize(ev: TraceEvent): string {
  if (ev.type === 'llm_call') {
    return `round ${ev.iteration} · ${ev.ms} ms · ${ev.requested?.length ? `→ ${ev.requested.join(', ')}` : 'final answer'}`
  }
  if (ev.type === 'tool_call') return `${ev.name}(…) · ${ev.ranIn}`
  if (ev.type === 'image_attached' || ev.type === 'error') return ev.text ?? ''
  const r = ev.result as Record<string, unknown> | string
  let what = ''
  if (typeof r === 'string') what = r.slice(0, 90)
  else if (r?.error) what = `⚠ ${String(r.error)}`
  else if (ev.type === 'retrieval') {
    const hits = (r.results as { source: string }[]) ?? []
    what = `${hits.length} chunks from ${[...new Set(hits.map((h) => h.source))].join(', ')}`
  } else if (r?.total_matches !== undefined) what = `${r.total_matches} match(es) in ${r.schema}.${r.entity}`
  else if (r?.created) what = `created ${(r.created as { id: string }).id} in ${r.schema}.${r.entity}`
  else if (r?.updated) what = `updated ${r.updated}`
  else if (r?.deleted) what = `deleted ${r.deleted}`
  else if (r?.schemas && Array.isArray(r.schemas)) what = `${r.schemas.length} schemas`
  else if (r?.analysis) what = `${(r.analysis as { image_type?: string }).image_type}: ${(r.analysis as { summary?: string }).summary ?? ''}`
  else if (r?.file) what = `saved ${r.file}`
  else if (r?.result !== undefined) what = `result: ${JSON.stringify(r.result).slice(0, 80)}`
  return `${ev.name} · ${ev.ms} ms${what ? ` · ${what}` : ''}`
}

/** Live list of every model round, tool call, result and retrieval of the hosted agent. */
export function TracePanel({ events, onClear }: { events: TraceEvent[]; onClear: () => void }) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [events])

  return (
    <aside className="trace-panel" aria-label="AI trace">
      <header>
        <strong>AI TRACE</strong>
        <span>every model call, retrieval, tool call &amp; result</span>
        <button type="button" className="ghost" onClick={onClear}>
          clear
        </button>
      </header>
      <div className="trace-list">
        {events.length === 0 && <p className="trace-empty">Ask something with the Hosted model to see each step here.</p>}
        {events.map((ev, i) => {
          const body = ev.type === 'tool_call' ? ev.args : ev.type === 'tool_result' || ev.type === 'retrieval' ? ev.result : undefined
          return (
            <div key={i} className={`trace-ev ${ev.type}`}>
              <div className="trace-line">
                <span className="trace-tag">{LABELS[ev.type]}</span>
                <span className="trace-text" title={summarize(ev)}>
                  {summarize(ev)}
                </span>
                <time>{ev.timestamp.slice(11, 23)}</time>
              </div>
              {body !== undefined && (
                <details open={ev.type === 'tool_call'}>
                  <summary>json</summary>
                  <pre>{typeof body === 'string' ? body : JSON.stringify(body, null, 2)}</pre>
                </details>
              )}
            </div>
          )
        })}
        <div ref={endRef} />
      </div>
    </aside>
  )
}

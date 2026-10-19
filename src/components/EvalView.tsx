import { useMemo, useRef, useState } from 'react'
import type { AgentReply } from '../ai/agent'
import { setAutoApprove } from '../ai/approval'
import { EVAL_CASES, grade } from '../eval/cases'
import type { EvalCase } from '../eval/cases'
import { useLocalStorage } from '../useLocalStorage'

interface CaseResult {
  pass: boolean
  failures: string[]
  tools: string[]
  seconds: number
  answer: string
}

/** A finished run, kept so changes can be compared with earlier ones. */
interface SavedRun {
  at: number
  model: string
  passed: number
  total: number
  avgSec: number
  byCategory: Record<string, [number, number]>
  failed: string[]
}

interface Props {
  /** Ask the assistant one question with the selected model, on its own (no chat history). */
  run: (question: string, signal: AbortSignal) => Promise<AgentReply>
  /** The model being scored, or null when none is available. */
  model: string | null
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

export function EvalView({ run, model }: Props) {
  const [results, setResults] = useState<Record<string, CaseResult>>({})
  const [running, setRunning] = useState(false)
  const [current, setCurrent] = useState<string | null>(null)
  const [category, setCategory] = useState('all')
  const [open, setOpen] = useState<string | null>(null)
  const [runs, setRuns] = useLocalStorage<SavedRun[]>('acme-assistant-eval-runs', [])
  const abort = useRef<AbortController | null>(null)

  const categories = useMemo(() => [...new Set(EVAL_CASES.map((c) => c.category))], [])
  const selected = EVAL_CASES.filter((c) => category === 'all' || c.category === category)
  const done = selected.filter((c) => results[c.id]).length
  const passed = selected.filter((c) => results[c.id]?.pass).length

  async function start(cases: EvalCase[]) {
    if (running || !model) return
    abort.current = new AbortController()
    const signal = abort.current.signal
    setRunning(true)
    setResults((r) => Object.fromEntries(Object.entries(r).filter(([id]) => !cases.some((c) => c.id === id))))
    setAutoApprove(true) // safe actions run without asking; tests never use risky tools
    const got: Record<string, CaseResult> = {}
    try {
      for (const c of cases) {
        if (signal.aborted) break
        setCurrent(c.id)
        c.setup?.()
        const t0 = performance.now()
        let reply: AgentReply
        try {
          reply = await run(c.question, signal)
        } catch (e) {
          reply = { text: `Error: ${(e as Error).message}`, calls: [], sources: [] }
        } finally {
          c.cleanup?.()
        }
        if (signal.aborted) break
        const g = grade(c, reply)
        got[c.id] = { pass: g.pass, failures: g.failures, tools: reply.calls.map((x) => x.tool), seconds: (performance.now() - t0) / 1000, answer: reply.text }
        setResults((r) => ({ ...r, [c.id]: got[c.id] }))
      }
    } finally {
      setAutoApprove(false)
      setRunning(false)
      setCurrent(null)
    }
    // Keep a summary of a complete run so later runs can be compared with it.
    if (!signal.aborted && Object.keys(got).length === cases.length && cases.length > 0) {
      const byCategory: Record<string, [number, number]> = {}
      for (const c of cases) {
        const cur = byCategory[c.category] ?? [0, 0]
        byCategory[c.category] = [cur[0] + (got[c.id].pass ? 1 : 0), cur[1] + 1]
      }
      const times = Object.values(got).map((g) => g.seconds)
      setRuns((rs) =>
        [
          {
            at: Date.now(),
            model: model + (category === 'all' ? '' : ` (${category})`),
            passed: Object.values(got).filter((g) => g.pass).length,
            total: cases.length,
            avgSec: times.reduce((a, b) => a + b, 0) / times.length,
            byCategory,
            failed: cases.filter((c) => !got[c.id].pass).map((c) => c.id),
          },
          ...rs,
        ].slice(0, 12),
      )
    }
  }

  const byCategory = categories.map((cat) => {
    const list = EVAL_CASES.filter((c) => c.category === cat && results[c.id])
    return { cat, passed: list.filter((c) => results[c.id].pass).length, total: list.length }
  })
  const times = selected.filter((c) => results[c.id]).map((c) => results[c.id].seconds)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Evaluate</h1>
          <p>
            Runs a fixed set of {EVAL_CASES.length} questions with known right behaviour against the selected model and scores which tools it used and what it
            answered. Run it again after changing a model, profile or prompt to see whether things got better or worse. A full run on a small CPU-only machine can
            take 20 minutes or more, so you can run one category at a time.
          </p>
        </div>
      </div>

      {!model && <p className="banner warn">No AI model is available. Start Ollama and pick a model first.</p>}

      <section className="group">
        <div className="eval-bar">
          <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={running} aria-label="Which questions to run">
            <option value="all">All categories ({EVAL_CASES.length})</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c} ({EVAL_CASES.filter((x) => x.category === c).length})
              </option>
            ))}
          </select>
          {running ? (
            <button type="button" className="btn danger" onClick={() => abort.current?.abort()}>
              Stop
            </button>
          ) : (
            <button type="button" className="btn primary" disabled={!model} onClick={() => start(selected)}>
              Run {selected.length} question{selected.length === 1 ? '' : 's'}
            </button>
          )}
          <span className="muted">
            {model ? `Model: ${model}` : ''}
            {running && current ? ` · running ${current}` : ''}
          </span>
        </div>
        {(running || done > 0) && (
          <div className="eval-progress" aria-label={`${done} of ${selected.length} done`}>
            <div style={{ width: `${pct(done, selected.length)}%` }} />
          </div>
        )}
        {done > 0 && (
          <div className="eval-tiles">
            <div className="eval-tile">
              <strong>{pct(passed, done)}%</strong>
              <span>
                passed ({passed} of {done})
              </span>
            </div>
            <div className="eval-tile">
              <strong>{times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : '–'} s</strong>
              <span>average per question</span>
            </div>
            {byCategory
              .filter((b) => b.total)
              .map((b) => (
                <div key={b.cat} className="eval-tile">
                  <strong>{pct(b.passed, b.total)}%</strong>
                  <span>
                    {b.cat} ({b.passed}/{b.total})
                  </span>
                </div>
              ))}
          </div>
        )}
      </section>

      <section className="group">
        <h2>Questions</h2>
        <div className="eval-table">
          {selected.map((c) => {
            const r = results[c.id]
            const state = r ? (r.pass ? 'pass' : 'fail') : current === c.id ? 'run' : 'wait'
            return (
              <div key={c.id} className={`eval-row ${state}`}>
                <button type="button" className="eval-head" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                  <span className="eval-mark" aria-label={state}>
                    {state === 'pass' ? '✓' : state === 'fail' ? '✗' : state === 'run' ? '…' : '○'}
                  </span>
                  <span className="eval-q">{c.question}</span>
                  <span className="eval-cat">{c.category}</span>
                  <span className="eval-tools">{r ? r.tools.join(', ') || 'no tool' : ''}</span>
                  <span className="eval-time">{r ? `${r.seconds.toFixed(1)} s` : ''}</span>
                </button>
                {open === c.id && r && (
                  <div className="eval-detail">
                    {r.failures.length > 0 && (
                      <ul>
                        {r.failures.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    )}
                    <pre>{r.answer || '(empty)'}</pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {runs.length > 0 && (
        <section className="group">
          <h2>
            Earlier runs <span className="count">{runs.length}</span>
          </h2>
          <div className="eval-table">
            {runs.map((r, i) => (
              <div key={r.at} className="eval-row">
                <div className="eval-head static">
                  <span className="eval-mark">{pct(r.passed, r.total)}%</span>
                  <span className="eval-q">
                    {r.model} · {r.passed}/{r.total} passed · {r.avgSec.toFixed(1)} s average
                    {r.failed.length ? ` · failed: ${r.failed.slice(0, 6).join(', ')}${r.failed.length > 6 ? '…' : ''}` : ''}
                  </span>
                  <span className="eval-time">{new Date(r.at).toLocaleString()}</span>
                </div>
                {i === 0 && runs.length > 1 && runs[1].total === r.total && (
                  <p className="muted eval-delta">
                    {r.passed - runs[1].passed >= 0 ? '+' : ''}
                    {r.passed - runs[1].passed} questions compared with the run before it
                  </p>
                )}
              </div>
            ))}
          </div>
          <div className="card-actions">
            <button type="button" className="btn small danger" onClick={() => setRuns([])}>
              Clear history
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

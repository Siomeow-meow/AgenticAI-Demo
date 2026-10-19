import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, DragEvent, ReactNode } from 'react'
import type { Turn } from '../ai/agent'
import type { SourceDoc } from '../ai/documents'
import { ATTACH_ACCEPT } from '../ai/files'
import type { Attachment } from '../ai/files'
import { TOOL_EXAMPLES } from '../ai/tool-examples'
import { Markdown } from './Markdown'
import type { Tool, ToolCall } from '../ai/tools'

export type { Turn }

/** The reply being written right now. */
export interface Pending {
  question: string
  text: string
  attachments: Attachment[]
  /** What the agent is doing at the moment ("Planning…", "Using calculator…"). */
  status?: string
}

/** Prompts about the written lessons and company documents (the tools supply the rest). */
const LESSON_PROMPTS = [
  'How many vacation days do I get?',
  'Explain the OSI model',
  'What is a three-way match in ERP?',
  'How does the 3-2-1 backup rule work?',
  'How do I read a balance sheet?',
  'How should I write a good work email?',
]

const CATEGORY_ORDER = [
  'Company data',
  'Your data',
  'ERP',
  'HR & payroll',
  'POS',
  'Business',
  'Finance',
  'IT',
  'Networking',
  'Math & utility',
  'Statistics & math',
  'Date & time',
  'Text & data',
  'Everyday life',
  'Education & decisions',
  'Personal workspace',
  'Internet',
]

/** Every category that has tools: the known ones in this order, then any new ones alphabetically (never hidden). */
function orderedCategories(present: Iterable<string>): string[] {
  const set = new Set(present)
  return [...CATEGORY_ORDER.filter((c) => set.has(c)), ...[...set].filter((c) => !CATEGORY_ORDER.includes(c)).sort()]
}

/** Sent when files are attached without any message. */
const DEFAULT_FILE_PROMPT = 'Look at the attached file(s): tell me what is in them and what I can ask.'

interface Props {
  turns: Turn[]
  pending: Pending | null
  tools: Tool[]
  internet: boolean
  onInternet: (on: boolean) => void
  onSend: (question: string, attachments: Attachment[]) => void
  onStop: () => void
  /** Ask the same question again (the last turn only). */
  onRegenerate: () => void
  /** Remove this question and everything after it so it can be edited and sent again. */
  onEdit: (index: number) => void
  onAttach: (files: File[]) => Promise<Attachment[]>
  learnables: (calls: ToolCall[]) => SourceDoc[]
  savedIds: Set<string>
  onSave: (doc: SourceDoc) => void
  modelPicker: ReactNode
}

export function Chat({ turns, pending, tools, internet, onInternet, onSend, onStop, onRegenerate, onEdit, onAttach, learnables, savedIds, onSave, modelPicker }: Props) {
  const endRef = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // Follow the reply as it is written, but only while the reader is at the bottom: scrolling up stops the following.
  const follow = useRef(true)
  const [awayFromBottom, setAwayFromBottom] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [reading, setReading] = useState(false)
  const [dragging, setDragging] = useState(false)
  // Editing a question puts its text back in the box (a new key makes the box start from it).
  const [draft, setDraft] = useState({ text: '', key: 0 })

  useEffect(() => {
    if (follow.current) endRef.current?.scrollIntoView({ behavior: pending?.text ? 'auto' : 'smooth', block: 'end' })
  }, [turns, pending])

  function onScroll() {
    const el = scroller.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    follow.current = atBottom
    setAwayFromBottom(!atBottom)
  }

  function jumpToLatest() {
    follow.current = true
    setAwayFromBottom(false)
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }

  async function attach(files: File[]) {
    if (!files.length) return
    setReading(true)
    try {
      const added = await onAttach(files)
      setAttachments((a) => [...a, ...added])
    } finally {
      setReading(false)
    }
  }

  function send(question: string) {
    follow.current = true // a new question always scrolls to the answer
    const usable = attachments.filter((a) => a.kind !== 'error')
    onSend(question || (usable.length ? DEFAULT_FILE_PROMPT : ''), usable)
    setAttachments([])
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void attach(Array.from(e.dataTransfer.files))
  }

  const empty = turns.length === 0 && !pending

  return (
    <div
      className="chat-view"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="drop-overlay">
          <div>
            <strong>Drop files to attach</strong>
            <span>CSV, Excel, PDF, Word, PowerPoint, JSON, text, images</span>
          </div>
        </div>
      )}
      <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
        <div className="chat-col">
          {empty && <Welcome tools={tools} internet={internet} onSend={(q) => send(q)} />}
          {turns.map((t, i) => (
            <Message
              key={i}
              turn={t}
              learnable={learnables(t.reply.calls)}
              savedIds={savedIds}
              onSave={onSave}
              canChange={!pending}
              onEdit={() => {
                setDraft((d) => ({ text: t.question, key: d.key + 1 }))
                onEdit(i)
              }}
              onRegenerate={i === turns.length - 1 ? onRegenerate : undefined}
            />
          ))}
          {pending && (
            <Message
              turn={{ question: pending.question, attachments: pending.attachments, reply: { text: pending.text, calls: [], sources: [] } }}
              status={pending.status}
              learnable={[]}
              savedIds={savedIds}
              onSave={onSave}
              streaming
            />
          )}
          <div ref={endRef} />
        </div>
        {pending && awayFromBottom && (
          <button type="button" className="jump-latest" onClick={jumpToLatest}>
            ↓ Jump to latest
          </button>
        )}
      </div>
      <Composer
        key={draft.key}
        initialText={draft.text}
        onStop={onStop}
        busy={pending !== null}
        reading={reading}
        attachments={attachments}
        onRemove={(i) => setAttachments((a) => a.filter((_, j) => j !== i))}
        onFiles={attach}
        internet={internet}
        onInternet={onInternet}
        onSend={send}
        modelPicker={modelPicker}
      />
    </div>
  )
}

function Welcome({ tools, internet, onSend }: { tools: Tool[]; internet: boolean; onSend: (q: string) => void }) {
  const groups = useMemo(() => {
    const byCat = new Map<string, string[]>()
    for (const t of tools) {
      const example = TOOL_EXAMPLES[t.name]
      if (!example || example.includes('\n')) continue
      byCat.set(t.category, [...(byCat.get(t.category) ?? []), example])
    }
    const ordered = orderedCategories(byCat.keys()).map((c) => [c, byCat.get(c)!.slice(0, 6)] as const)
    return [['Lessons & policies', LESSON_PROMPTS] as const, ...ordered]
  }, [tools])

  const [active, setActive] = useState('Lessons & policies')
  const visible = groups.filter(([name]) => name !== 'Internet' || internet)
  const current = visible.find(([name]) => name === active) ?? visible[0]

  return (
    <div className="welcome">
      <div className="hero-mark">✦</div>
      <h1>How can I help today?</h1>
      <p>Ask a question, run a calculation, learn something new, or attach a file and chat with your data.</p>
      <div className="attach-hint">📎 Drop or attach CSV, Excel, PDF, Word, PowerPoint, JSON or text files, then ask about them. Images work too if you install a vision model (ollama pull qwen2.5vl:3b).</div>
      <div className="tabs">
        {visible.map(([name]) => (
          <button key={name} type="button" className={name === current[0] ? 'on' : ''} onClick={() => setActive(name)}>
            {name}
          </button>
        ))}
      </div>
      <div className="prompt-grid">
        {current[1].map((p) => (
          <button key={p} type="button" className="prompt-card" onClick={() => onSend(p)}>
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

function AttachmentChips({ list, onRemove }: { list: Attachment[]; onRemove?: (i: number) => void }) {
  return (
    <div className="file-chips">
      {list.map((a, i) => (
        <span key={`${a.name}-${i}`} className={`file-chip ${a.kind}`} title={a.detail}>
          {a.kind === 'image' && a.url ? (
            <img className="file-thumb" src={a.url} alt="" />
          ) : (
            <span className="file-icon">{a.kind === 'table' ? '▦' : a.kind === 'document' ? '📄' : a.kind === 'image' ? '🖼' : '⚠'}</span>
          )}
          <span className="file-name">{a.name}</span>
          <span className="file-detail">{a.kind === 'error' ? a.detail : a.detail.split(';')[0]}</span>
          {onRemove && (
            <button type="button" aria-label={`Remove ${a.name}`} onClick={() => onRemove(i)}>
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  )
}

function Message({
  turn,
  learnable,
  savedIds,
  onSave,
  streaming = false,
  status,
  canChange = false,
  onEdit,
  onRegenerate,
}: {
  turn: Turn
  learnable: SourceDoc[]
  savedIds: Set<string>
  onSave: (doc: SourceDoc) => void
  streaming?: boolean
  status?: string
  canChange?: boolean
  onEdit?: () => void
  onRegenerate?: () => void
}) {
  const { question, reply, attachments } = turn
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard?.writeText(reply.text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="turn">
      <div className="user-msg">
        {attachments && attachments.length > 0 && <AttachmentChips list={attachments} />}
        {question}
        {onEdit && canChange && (
          <button type="button" className="msg-edit" onClick={onEdit} title="Edit this question and ask again (removes the replies after it)" aria-label="Edit question">
            ✎
          </button>
        )}
      </div>
      <div className="assistant-msg">
        <div className="avatar">✦</div>
        <div className="assistant-body">
          {reply.plan && reply.plan.length > 0 && (
            <details className="step plan">
              <summary>
                <span className="step-icon">☰</span> Plan <span className="muted">({reply.plan.length} steps)</span>
              </summary>
              <ol>
                {reply.plan.map((s, k) => (
                  <li key={k}>{s}</li>
                ))}
              </ol>
            </details>
          )}
          {streaming && status && <div className="status-line">{status}</div>}
          {reply.calls.map((c, j) => (
            <details key={j} className="step">
              <summary>
                <span className="step-icon">⚙</span> Used <code>{c.tool}</code>
              </summary>
              <pre>
                {JSON.stringify(c.args)}
                {'\n→ '}
                {c.result}
              </pre>
            </details>
          ))}
          {reply.text ? (
            <div className={`answer${streaming ? ' streaming' : ''}`}>
              <Markdown text={reply.text} />
            </div>
          ) : reply.stopped ? (
            <div className="answer muted">Stopped before an answer was written.</div>
          ) : (
            <div className="thinking">
              <span />
              <span />
              <span />
            </div>
          )}
          {reply.stopped && reply.text && <div className="reply-stats">Stopped by you. The reply above is incomplete.</div>}
          {reply.check && !streaming && (
            <div className={`check-tag ${reply.check}`} title="The answer was compared with what the tools returned">
              {reply.check === 'ok' ? '✓ Checked against the tool results' : '↻ Rewritten after a check found a mismatch with the tool results'}
            </div>
          )}
          {reply.stats && !streaming && (
            <div className="reply-stats" title="How long this reply took and how it was produced">
              {reply.stats.firstSec.toFixed(1)} s to first word · {reply.stats.tokensPerSec ? `${reply.stats.tokensPerSec.toFixed(0)} tokens/s · ` : ''}
              read {reply.stats.promptTokens.toLocaleString('en-US')} tokens · {Math.round(reply.stats.ctx / 1024)}k context
              {reply.stats.loadSec > 1 ? ` · loaded the model in ${reply.stats.loadSec.toFixed(0)} s` : ''}
              {reply.stats.gpu !== null ? ` · ${reply.stats.gpu === 0 ? 'CPU only' : `${Math.round(reply.stats.gpu * 100)}% on GPU`}` : ''}
            </div>
          )}
          {reply.sources.length > 0 && (
            <div className="sources">
              {reply.sources.map((s) => (
                <span key={s.id} title={`relevance ${s.score.toFixed(2)}`}>
                  {s.title}
                </span>
              ))}
            </div>
          )}
          {learnable.map((d) => (
            <button key={d.id} type="button" className="save" disabled={savedIds.has(d.id)} onClick={() => onSave(d)}>
              {savedIds.has(d.id) ? `✓ Saved "${d.title}"` : `Save "${d.title}" to knowledge`}
            </button>
          ))}
          {!streaming && (
            <div className="meta">
              {reply.model && <span>{reply.model}</span>}
              {reply.offered && reply.offered.length > 0 && <span>tools offered: {reply.offered.join(', ')}</span>}
              <button type="button" className="ghost" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
              {onRegenerate && canChange && (
                <button type="button" className="ghost" onClick={onRegenerate} title="Ask the same question again">
                  Regenerate
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Composer({
  initialText,
  onStop,
  busy,
  reading,
  attachments,
  onRemove,
  onFiles,
  internet,
  onInternet,
  onSend,
  modelPicker,
}: {
  initialText: string
  onStop: () => void
  busy: boolean
  reading: boolean
  attachments: Attachment[]
  onRemove: (i: number) => void
  onFiles: (files: File[]) => void
  internet: boolean
  onInternet: (on: boolean) => void
  onSend: (q: string) => void
  modelPicker: ReactNode
}) {
  const [text, setText] = useState(initialText)
  const ref = useRef<HTMLTextAreaElement>(null)
  const hasFiles = attachments.some((a) => a.kind !== 'error')
  const canSend = !busy && !reading && (text.trim() !== '' || hasFiles)

  function resize() {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  function submit() {
    if (!canSend) return
    onSend(text.trim())
    setText('')
    requestAnimationFrame(resize)
  }

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    onFiles(files)
  }

  function paste(e: ClipboardEvent) {
    const files = Array.from(e.clipboardData.files)
    if (files.length) {
      e.preventDefault()
      onFiles(files)
    }
  }

  return (
    <div className="composer-wrap">
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {(attachments.length > 0 || reading) && (
          <div className="attach-row">
            <AttachmentChips list={attachments} onRemove={onRemove} />
            {reading && <span className="reading">Reading files…</span>}
          </div>
        )}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={hasFiles ? 'Ask about the attached files…' : 'Message Acme Assistant…'}
          onChange={(e) => {
            setText(e.target.value)
            resize()
          }}
          onPaste={paste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="composer-row">
          <label className="chip attach" title="Attach files: CSV, Excel, PDF, Word, PowerPoint, JSON, text, images (needs a vision model)">
            📎 Attach
            <input type="file" multiple hidden accept={ATTACH_ACCEPT} onChange={pick} />
          </label>
          <button type="button" className={`chip${internet ? ' on' : ''}`} onClick={() => onInternet(!internet)} title="Lets tools like weather, Wikipedia and exchange rates send your question text to public services">
            🌐 Internet tools {internet ? 'on' : 'off'}
          </button>
          <span className="spacer" />
          {modelPicker}
          {busy ? (
            <button type="button" className="send stop" onClick={onStop} aria-label="Stop generating" title="Stop">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button type="submit" className="send" disabled={!canSend} aria-label="Send message">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
      </form>
      <p className="fineprint">AI can make mistakes. Check important facts, numbers and policies. Attached files stay on this computer.</p>
    </div>
  )
}

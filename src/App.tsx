import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sampleDocs } from './ai/documents'
import type { SourceDoc } from './ai/documents'
import { describeAttachments, ingestFiles } from './ai/files'
import { compactCalls } from './ai/history'
import { captureFacts } from './ai/tools/memory'
import { approvals } from './ai/approval'
import type { ApprovalAnswer, ApprovalRequest } from './ai/approval'
import { prepareModel } from './ai/prepare'
import { quickHelp, toolkitAnswer } from './ai/help'
import type { Attachment } from './ai/files'
import { learnedDoc } from './ai/ingest'
import { createLlmAgent, DEFAULT_MODEL, modelOption, unloadModel } from './ai/llm'
import type { ProfileChoice } from './ai/profile'
import { buildSemantic, checkEmbedModel, EMBED_MODEL, listChatModels } from './ai/ollama'
import type { InstalledModel } from './ai/ollama'
import { buildIndex } from './ai/rag'
import type { Index, Semantic } from './ai/rag'
import type { ToolCall } from './ai/tools'
import { ApprovalDialog } from './components/ApprovalDialog'
import { Chat } from './components/Chat'
import type { Pending, Turn } from './components/Chat'
import { EvalView } from './components/EvalView'
import { KnowledgeView } from './components/KnowledgeView'
import { ModelPicker } from './components/ModelPicker'
import { ModelsView } from './components/ModelsView'
import { Toolkit } from './components/Toolkit'
import { WorkspaceView } from './components/WorkspaceView'
import { useConversations, toMarkdown } from './useConversations'
import { useLocalStorage } from './useLocalStorage'
import './App.css'

type Theme = 'system' | 'light' | 'dark'
type View = 'chat' | 'toolkit' | 'knowledge' | 'models' | 'evaluate' | 'workspace'

const VIEW_TITLES: Record<View, string> = {
  chat: 'Chat',
  toolkit: 'Toolkit',
  knowledge: 'Knowledge',
  models: 'Models',
  evaluate: 'Evaluate',
  workspace: 'Workspace',
}

function App() {
  const [theme, setTheme] = useLocalStorage<Theme>('acme-assistant-theme', 'system')
  const [view, setView] = useState<View>(() => {
    const hash = window.location.hash.slice(1)
    return hash in VIEW_TITLES ? (hash as View) : 'chat'
  })
  const [uploaded, setUploaded] = useLocalStorage<SourceDoc[]>('acme-assistant-uploads', [])
  const { turns, active: activeChat, items: chats, setTurns, newChat, select: selectChat, remove: removeChat, rename: renameChat } = useConversations()
  const [chatFilter, setChatFilter] = useState('')
  const [internet, setInternet] = useLocalStorage<boolean>('acme-assistant-internet', false)
  const [semanticOn, setSemanticOn] = useLocalStorage<boolean>('acme-assistant-semantic', false)
  const [storedModelId, setModelId] = useLocalStorage<string>('acme-assistant-model', DEFAULT_MODEL)
  const [profileChoice, setProfileChoice] = useLocalStorage<ProfileChoice>('acme-assistant-profile', 'auto')
  const [embedReady, setEmbedReady] = useState(false)
  const [built, setBuilt] = useState<{ index: Index; semantic: Semantic } | null>(null)
  const [semanticError, setSemanticError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [approval, setApproval] = useState<{ request: ApprovalRequest; resolve: (a: ApprovalAnswer) => void } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [installed, setInstalled] = useState<InstalledModel[] | null | 'checking'>('checking')

  // The model in use: the saved choice, or (if that one is not installed here, or it was the removed Hosted/Basic option)
  // the most capable installed model that can use tools, so the app works on any machine without picking one.
  const installedList = Array.isArray(installed) ? installed : []
  const modelId = (() => {
    if (!installedList.length || installedList.some((m) => m.name === storedModelId)) return storedModelId === 'hosted' || storedModelId === 'offline' ? DEFAULT_MODEL : storedModelId
    const best = [...installedList].sort((x, y) => Number(y.tools) - Number(x.tools) || y.sizeGB - x.sizeGB)[0]
    return best.name
  })()

  const docs = useMemo(() => [...sampleDocs, ...uploaded], [uploaded])
  const index = useMemo(() => buildIndex(docs), [docs])
  const semantic = semanticOn && built?.index === index ? built.semantic : null
  const ctx = useMemo(() => ({ index, docs, semantic }), [index, docs, semantic])
  const llm = useMemo(() => createLlmAgent(ctx), [ctx])
  const allTools = llm.tools

  // Actions that change something outside the chat (writing files, posting to a webhook) ask first, through a dialog.
  useEffect(() => {
    approvals.ask = (request) => new Promise<ApprovalAnswer>((resolve) => setApproval({ request, resolve }))
    return () => {
      approvals.ask = null
    }
  }, [])
  const answerApproval = useCallback(
    (answer: ApprovalAnswer) => {
      approval?.resolve(answer)
      setApproval(null)
    },
    [approval],
  )

  // Light / dark / follow-the-system: CSS reads the data-theme attribute on <html>.
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme
  }, [theme])

  // Keep the address bar in step with the page, so views can be bookmarked (e.g. #toolkit).
  useEffect(() => {
    window.history.replaceState(null, '', `#${view}`)
  }, [view])

  useEffect(() => {
    listChatModels().then(setInstalled)
    checkEmbedModel().then(setEmbedReady)

    // Models pulled or deleted in a terminal show up when you come back to this tab.
    const recheck = () => {
      if (document.visibilityState === 'visible') {
        listChatModels().then(setInstalled)
        checkEmbedModel().then(setEmbedReady)
      }
    }
    document.addEventListener('visibilitychange', recheck)
    window.addEventListener('focus', recheck)
    return () => {
      document.removeEventListener('visibilitychange', recheck)
      window.removeEventListener('focus', recheck)
    }
  }, [])

  // Build the embedding index (only when switched on) for the current set of documents.
  useEffect(() => {
    if (!semanticOn || !embedReady) return
    let stale = false
    buildSemantic(index.chunks)
      .then((s) => {
        if (stale) return
        setBuilt({ index, semantic: s })
        setSemanticError(null)
      })
      .catch((e: Error) => {
        if (!stale) setSemanticError(e.message)
      })
    return () => {
      stale = true
    }
  }, [semanticOn, embedReady, index])

  const found = Array.isArray(installed) ? installed.find((m) => m.name === modelId) : undefined
  const model = found && modelOption(found, profileChoice)
  const usingLlm = model !== undefined
  const busy = pending !== null

  // Why the AI model is not being used (shown under the top bar), or null when it is.
  const llmStatus: string | null =
    installed === 'checking'
      ? null
      : installed === null
        ? 'Ollama is not running at http://127.0.0.1:11434. Start it to chat'
        : usingLlm
          ? null
          : installed.length === 0
            ? 'No AI model is installed. Open the Models tab to download one, or run: ollama pull qwen2.5:7b'
            : `Model not found. Run: ollama pull ${modelId}`

  function chooseModel(next: string) {
    if (model && next !== model.id) unloadModel(model.id) // free its RAM straight away
    setModelId(next)
  }

  /**
   * Ask a question. `base` is the conversation to continue from (the current one, or a shortened copy when
   * regenerating or editing); the new turn is added after it.
   */
  async function ask(question: string, attachments: Attachment[] = [], base: Turn[] = turns) {
    const q = question.trim()
    if (!q || busy) return
    setView('chat')
    const learned = captureFacts(q)
    if (learned.length) {
      setNotice(`Remembered: ${learned.join('; ')}`)
      setTimeout(() => setNotice(null), 5000)
    }
    const controller = new AbortController()
    abortRef.current = controller
    const show = (text: string) => setPending((p) => ({ question: q, attachments, status: p?.status, text }))
    const status = (s: string) => setPending((p) => (p ? { ...p, status: s } : p))
    setPending({ question: q, text: '', attachments })
    try {
      // Right after the page opens the model list may still be loading: wait for it.
      let active = model
      if (installed === 'checking') {
        const list = await listChatModels()
        setInstalled(list)
        const f = list?.find((m) => m.name === modelId) ?? [...(list ?? [])].sort((x, y) => Number(y.tools) - Number(x.tools) || y.sizeGB - x.sizeGB)[0]
        active = f && modelOption(f, profileChoice)
      }
      // First use of this model: check it fits in GPU memory and lower the context window if it does not (once per model).
      if (active) {
        const prepared = await prepareModel(active, status)
        active = prepared.model
        if (prepared.lowered) {
          setNotice(`Context lowered to ${active.profile.numCtx.toLocaleString('en-US')} tokens so ${active.id} stays on the GPU (faster).`)
          setTimeout(() => setNotice(null), 8000)
        }
      }
      // The model is told which files were attached; the chat only shows the question and the file chips.
      const history = base.flatMap((t) => [
        { role: 'user' as const, content: t.question + describeAttachments(t.attachments ?? []) },
        { role: 'assistant' as const, content: t.reply.text, facts: compactCalls(t.reply.calls) },
      ])
      const help = attachments.length ? null : (toolkitAnswer(q, allTools) ?? quickHelp(q))
      const reply = help
        ? { text: help, calls: [], sources: [] }
        : active
        ? await llm.respond(history, q + describeAttachments(attachments), show, internet, active, attachments, { signal: controller.signal, onStatus: status })
        : { text: `${llmStatus ?? 'No AI model is available.'}. Pick a model in the message box, or open the Models tab.`, calls: [], sources: [] }
      setTurns([...base, { question: q, reply, attachments }])
    } catch (e) {
      const text = controller.signal.aborted ? '' : `Error: ${(e as Error).message}`
      setTurns([...base, { question: q, reply: { text, calls: [], sources: [], ...(controller.signal.aborted ? { stopped: true } : {}) }, attachments }])
    } finally {
      setPending(null)
      abortRef.current = null
    }
  }

  /** The Stop button: stop the reply (and refuse any action it was waiting to be approved). */
  function stop() {
    abortRef.current?.abort()
    if (approval) {
      approval.resolve('deny')
      setApproval(null)
    }
  }

  /** Ask the last question again, replacing its answer. */
  function regenerate() {
    if (busy || !turns.length) return
    const last = turns[turns.length - 1]
    const base = turns.slice(0, -1)
    setTurns(base)
    void ask(last.question, last.attachments ?? [], base)
  }

  /** Remove a question and everything after it; the chat box already holds its text again. */
  function editFrom(index: number) {
    if (busy) return
    setTurns(turns.slice(0, index))
  }

  /** One question for the Evaluate tab: no chat history, nothing saved. */
  async function runEval(question: string, signal: AbortSignal) {
    if (!model) throw new Error('No AI model is available.')
    const { model: prepared } = await prepareModel(model)
    return llm.respond([], question, () => {}, false, prepared, [], { signal })
  }

  function exportChat() {
    const url = URL.createObjectURL(new Blob([toMarkdown(activeChat)], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${activeChat.title.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'chat'}.md`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  const shownChats = useMemo(() => {
    const f = chatFilter.trim().toLowerCase()
    return [...chats]
      .filter((c) => c.turns.length > 0 || c.id === activeChat.id)
      .filter((c) => !f || c.title.toLowerCase().includes(f) || c.turns.some((t) => t.question.toLowerCase().includes(f) || t.reply.text.toLowerCase().includes(f)))
      .sort((x, y) => y.updatedAt - x.updatedAt)
  }, [chats, chatFilter, activeChat.id])

  /** Read files, make tables available to the data tools and text to the knowledge search. */
  const attachFiles = (files: File[]) =>
    ingestFiles(files, (docs) => setUploaded((u) => [...u.filter((d) => !docs.some((a) => a.id === d.id)), ...docs]))

  async function onUpload(files: File[]) {
    const result = await attachFiles(files)
    const tables = result.filter((a) => a.kind === 'table').length
    const docsAdded = result.filter((a) => a.kind === 'document').length
    const failed = result.filter((a) => a.kind === 'error')
    setNotice(
      [
        tables ? `${tables} table${tables > 1 ? 's' : ''} added and searchable` : '',
        docsAdded ? `${docsAdded} document${docsAdded > 1 ? 's' : ''} added to Knowledge` : '',
        ...failed.map((f) => `${f.name}: ${f.detail}`),
      ]
        .filter(Boolean)
        .join('. '),
    )
    setTimeout(() => setNotice(null), 8000)
  }

  function learnables(calls: ToolCall[]) {
    return calls.flatMap((c) => {
      const learn = allTools.find((t) => t.name === c.tool)?.learn?.(c.args, c.result)
      return learn ? [learnedDoc(learn)] : []
    })
  }

  const savedIds = useMemo(() => new Set(uploaded.map((d) => d.id)), [uploaded])
  const chunkCount = (id: string) => index.chunks.filter((c) => c.docId === id).length

  const nav: { id: View; label: string; icon: string; count?: number }[] = [
    { id: 'chat', label: 'Chat', icon: '💬' },
    { id: 'toolkit', label: 'Toolkit', icon: '🧰', count: allTools.length },
    { id: 'knowledge', label: 'Knowledge', icon: '📚', count: docs.length },
    { id: 'models', label: 'Models', icon: '🧠' },
    { id: 'evaluate', label: 'Evaluate', icon: '🧪' },
    { id: 'workspace', label: 'Workspace', icon: '✅' },
  ]

  const dot = usingLlm ? 'ok' : installed === 'checking' ? 'idle' : 'warn'
  const activeLabel = model ? model.id : 'No model'

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <span className="logo">✦</span>
          <span className="brand-name">Acme Assistant</span>
        </div>
        <button
          type="button"
          className="new-chat"
          disabled={busy}
          onClick={() => {
            newChat()
            setView('chat')
          }}
        >
          <span>＋</span> New chat
        </button>
        {shownChats.length > 0 && (
          <div className="chat-list" aria-label="Your chats">
            {chats.filter((c) => c.turns.length > 0).length > 5 && (
              <input className="chat-search" value={chatFilter} onChange={(e) => setChatFilter(e.target.value)} placeholder="Search chats…" aria-label="Search chats" />
            )}
            {shownChats.map((c) => (
              <div key={c.id} className={`chat-item${c.id === activeChat.id ? ' active' : ''}`}>
                <button
                  type="button"
                  className="chat-open"
                  disabled={busy}
                  title={c.title}
                  onClick={() => {
                    selectChat(c.id)
                    setView('chat')
                  }}
                >
                  {c.title}
                </button>
                {c.turns.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="chat-act"
                      disabled={busy}
                      aria-label={`Rename ${c.title}`}
                      title="Rename"
                      onClick={() => {
                        const name = window.prompt('Rename this chat', c.title)
                        if (name) renameChat(c.id, name)
                      }}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="chat-act"
                      disabled={busy}
                      aria-label={`Delete ${c.title}`}
                      title="Delete"
                      onClick={() => {
                        if (window.confirm(`Delete "${c.title}"?`)) removeChat(c.id)
                      }}
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        <nav>
          {nav.map((n) => (
            <button key={n.id} type="button" className={view === n.id ? 'active' : ''} onClick={() => setView(n.id)}>
              <span className="icon">{n.icon}</span>
              <span className="label">{n.label}</span>
              {n.count !== undefined && <span className="badge-count">{n.count}</span>}
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <span className={`dot ${dot}`} />
          <span>{installed === 'checking' ? 'Checking…' : activeLabel}</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h2>{VIEW_TITLES[view]}</h2>
          <div className="topbar-right">
            {view === 'chat' && turns.length > 0 && (
              <button type="button" className="btn small" onClick={exportChat} title="Save this chat as a Markdown file">
                Export chat
              </button>
            )}
            <div className="theme-switch" role="group" aria-label="Colour theme">
              {([['light', '☀', 'Light'], ['system', '◐', 'Match system'], ['dark', '☾', 'Dark']] as const).map(([id, icon, label]) => (
                <button key={id} type="button" className={theme === id ? 'on' : ''} title={label} aria-label={label} aria-pressed={theme === id} onClick={() => setTheme(id)}>
                  {icon}
                </button>
              ))}
            </div>
          </div>
        </header>
        {llmStatus && <p className="banner warn">{llmStatus}.</p>}
        {notice && <p className="banner ok">{notice}</p>}

        {view === 'chat' && (
          <Chat
            turns={turns}
            pending={pending}
            tools={allTools}
            internet={internet}
            onInternet={setInternet}
            onSend={(q, files) => ask(q, files)}
            onStop={stop}
            onRegenerate={regenerate}
            onEdit={editFrom}
            onAttach={attachFiles}
            learnables={learnables}
            savedIds={savedIds}
            onSave={(doc) => setUploaded((u) => [...u.filter((d) => d.id !== doc.id), doc])}
            modelPicker={
              <ModelPicker placement="up" installed={installed} modelId={modelId} dot={dot} disabled={busy} onChoose={chooseModel} onManage={() => setView('models')} />
            }
          />
        )}
        {view === 'toolkit' && <Toolkit tools={allTools} internet={internet} onInternet={setInternet} onTry={(p) => ask(p)} />}
        {view === 'knowledge' && (
          <KnowledgeView
            docs={docs}
            uploadedIds={savedIds}
            chunkCount={chunkCount}
            onUpload={onUpload}
            onRemove={(id) => setUploaded((u) => u.filter((d) => d.id !== id))}
            onAsk={(p) => ask(p)}
            semantic={{
              on: semanticOn,
              ready: embedReady,
              indexing: semanticOn && embedReady && !semantic && !semanticError,
              error: semanticError,
              embedModel: EMBED_MODEL,
              onToggle: setSemanticOn,
            }}
          />
        )}
        {view === 'models' && (
          <ModelsView installed={installed} modelId={modelId} profileChoice={profileChoice} onProfileChoice={setProfileChoice} onChoose={chooseModel} onRefresh={() => listChatModels().then(setInstalled)} />
        )}
        {view === 'evaluate' && <EvalView run={runEval} model={model?.id ?? null} />}
        {view === 'workspace' && <WorkspaceView />}
      </main>
      {approval && <ApprovalDialog request={approval.request} onAnswer={answerApproval} />}
    </div>
  )
}

export default App

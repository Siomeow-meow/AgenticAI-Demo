import { useEffect, useMemo, useState } from 'react'
import { createAgent } from './ai/agent'
import { sampleDocs } from './ai/documents'
import type { SourceDoc } from './ai/documents'
import { describeAttachments, ingestFiles } from './ai/files'
import { quickHelp, toolkitAnswer } from './ai/help'
import type { Attachment } from './ai/files'
import { learnedDoc } from './ai/ingest'
import { createLlmAgent, DEFAULT_MODEL, OFFLINE, unloadModel } from './ai/llm'
import { buildSemantic, checkEmbedModel, EMBED_MODEL, listChatModels } from './ai/ollama'
import type { InstalledModel } from './ai/ollama'
import { buildIndex } from './ai/rag'
import type { Index, Semantic } from './ai/rag'
import type { ToolCall } from './ai/tools'
import { Chat } from './components/Chat'
import type { Turn } from './components/Chat'
import { KnowledgeView } from './components/KnowledgeView'
import { ModelPicker } from './components/ModelPicker'
import { ModelsView } from './components/ModelsView'
import { Toolkit } from './components/Toolkit'
import { WorkspaceView } from './components/WorkspaceView'
import { useLocalStorage } from './useLocalStorage'
import './App.css'

type Theme = 'system' | 'light' | 'dark'
type View = 'chat' | 'toolkit' | 'knowledge' | 'models' | 'workspace'

const VIEW_TITLES: Record<View, string> = {
  chat: 'Chat',
  toolkit: 'Toolkit',
  knowledge: 'Knowledge',
  models: 'Models',
  workspace: 'Workspace',
}

function App() {
  const [theme, setTheme] = useLocalStorage<Theme>('acme-assistant-theme', 'system')
  const [view, setView] = useState<View>(() => {
    const hash = window.location.hash.slice(1)
    return hash in VIEW_TITLES ? (hash as View) : 'chat'
  })
  const [uploaded, setUploaded] = useLocalStorage<SourceDoc[]>('acme-assistant-uploads', [])
  const [turns, setTurns] = useLocalStorage<Turn[]>('acme-assistant-chat', [])
  const [internet, setInternet] = useLocalStorage<boolean>('acme-assistant-internet', false)
  const [semanticOn, setSemanticOn] = useLocalStorage<boolean>('acme-assistant-semantic', false)
  const [modelId, setModelId] = useLocalStorage<string>('acme-assistant-model', DEFAULT_MODEL)
  const [embedReady, setEmbedReady] = useState(false)
  const [built, setBuilt] = useState<{ index: Index; semantic: Semantic } | null>(null)
  const [semanticError, setSemanticError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ question: string; text: string; attachments: Attachment[] } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [installed, setInstalled] = useState<InstalledModel[] | null | 'checking'>('checking')

  const docs = useMemo(() => [...sampleDocs, ...uploaded], [uploaded])
  const index = useMemo(() => buildIndex(docs), [docs])
  const semantic = semanticOn && built?.index === index ? built.semantic : null
  const ctx = useMemo(() => ({ index, docs, semantic }), [index, docs, semantic])
  const offline = useMemo(() => createAgent(ctx), [ctx])
  const llm = useMemo(() => createLlmAgent(ctx), [ctx])
  const allTools = llm.tools

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
  const model = found && { id: found.name, thinking: found.thinking, tools: found.tools }
  const usingLlm = model !== undefined
  const busy = pending !== null

  // Why the AI model is not being used (shown under the top bar), or null when it is.
  const llmStatus: string | null =
    installed === 'checking' || modelId === OFFLINE
      ? null
      : installed === null
        ? 'Ollama is not running at http://127.0.0.1:11434'
        : usingLlm
          ? null
          : `Model not found. Run: ollama pull ${modelId}`

  function chooseModel(next: string) {
    if (model && next !== model.id) unloadModel(model.id) // free its RAM straight away
    setModelId(next)
  }

  async function ask(question: string, attachments: Attachment[] = []) {
    const q = question.trim()
    if (!q || busy) return
    setView('chat')
    setPending({ question: q, text: '', attachments })
    try {
      // Right after the page opens the model list may still be loading: wait for it rather than silently using the basic agent.
      let active = model
      if (installed === 'checking') {
        const list = await listChatModels()
        setInstalled(list)
        const f = list?.find((m) => m.name === modelId)
        active = f && { id: f.name, thinking: f.thinking, tools: f.tools }
      }
      // The model is told which files were attached; the chat only shows the question and the file chips.
      const history = turns.flatMap((t) => [
        { role: 'user' as const, content: t.question + describeAttachments(t.attachments ?? []) },
        { role: 'assistant' as const, content: t.reply.text },
      ])
      const help = attachments.length ? null : (toolkitAnswer(q, allTools) ?? quickHelp(q))
      const reply = help
        ? { text: help, calls: [], sources: [] }
        : active
        ? await llm.respond(history, q + describeAttachments(attachments), (text) => setPending({ question: q, text, attachments }), internet, active, attachments)
        : await offline.respond(q)
      setTurns((t) => [...t, { question: q, reply, attachments }])
    } catch (e) {
      const text = `Error: ${(e as Error).message}`
      setTurns((t) => [...t, { question: q, reply: { text, calls: [], sources: [] }, attachments }])
    } finally {
      setPending(null)
    }
  }

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
    { id: 'workspace', label: 'Workspace', icon: '✅' },
  ]

  const dot = usingLlm ? 'ok' : installed === 'checking' || modelId === OFFLINE ? 'idle' : 'warn'

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
            setTurns([])
            setView('chat')
          }}
        >
          <span>＋</span> New chat
        </button>
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
          <span>{usingLlm ? model.id : modelId === OFFLINE ? 'Basic mode' : installed === 'checking' ? 'Checking…' : 'No model'}</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h2>{VIEW_TITLES[view]}</h2>
          <div className="topbar-right">
            <div className="theme-switch" role="group" aria-label="Colour theme">
              {([['light', '☀', 'Light'], ['system', '◐', 'Match system'], ['dark', '☾', 'Dark']] as const).map(([id, icon, label]) => (
                <button key={id} type="button" className={theme === id ? 'on' : ''} title={label} aria-label={label} aria-pressed={theme === id} onClick={() => setTheme(id)}>
                  {icon}
                </button>
              ))}
            </div>
          <ModelPicker installed={installed} modelId={modelId} dot={dot} disabled={busy} onChoose={chooseModel} onManage={() => setView('models')} />
          </div>
        </header>
        {llmStatus && <p className="banner warn">{llmStatus} - using the basic rule-based agent.</p>}
        {notice && <p className="banner ok">{notice}</p>}

        {view === 'chat' && (
          <Chat
            turns={turns}
            pending={pending}
            tools={allTools}
            internet={internet}
            onInternet={setInternet}
            onSend={ask}
            onAttach={attachFiles}
            learnables={learnables}
            savedIds={savedIds}
            onSave={(doc) => setUploaded((u) => [...u.filter((d) => d.id !== doc.id), doc])}
            modelLabel={usingLlm ? model.id : 'Basic mode'}
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
          <ModelsView installed={installed} modelId={modelId} onChoose={chooseModel} onRefresh={() => listChatModels().then(setInstalled)} />
        )}
        {view === 'workspace' && <WorkspaceView />}
      </main>
    </div>
  )
}

export default App

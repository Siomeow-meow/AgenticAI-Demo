import type { AgentReply } from './agent'
import type { Attachment } from './files'
import type { ChatMsg } from './llm'
import type { Source } from './rag'
import { selectTools } from './router'
import type { Tool, ToolCall } from './tools'

/**
 * The hosted model (Qwen 3.6 or any OpenAI-compatible API) behind the local Python
 * server in ./server. The browser never sees the API key: every model turn goes
 * through POST /api/llm/chat, which Vite proxies to http://127.0.0.1:8000.
 *
 * The agent loop itself runs here, so the app's own browser tools (calculators,
 * finance, IT, datasets...) keep working next to the 10 universal tools that run
 * on the server (schemas, records, analytics, ChromaDB search, reports, vision).
 */

/** Model-picker value for the hosted model. */
export const HOSTED = 'hosted'

const API = '/api'
const MAX_STEPS = 8
const MAX_TOOL_RESULT = 12000

export interface HostedStatus {
  /** The Python server answered. */
  reachable: boolean
  model?: string
  keySet?: boolean
  schemas?: number
  chunks?: number
}

/** One step of the agent's work, shown live in the AI Trace panel. */
export interface TraceEvent {
  type: 'llm_call' | 'tool_call' | 'tool_result' | 'retrieval' | 'image_attached' | 'error'
  timestamp: string
  name?: string
  args?: unknown
  result?: unknown
  ms?: number
  iteration?: number
  requested?: string[]
  text?: string
  /** Where the tool ran: the Python server (universal tools) or this browser (the app's own tools). */
  ranIn?: 'server' | 'browser'
}

interface OpenAiTool {
  type: 'function'
  function: { name: string; description: string; parameters: unknown }
}

interface ModelTurn {
  content: string
  tool_calls: { id: string; name: string; arguments: string }[]
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { detail?: string }).detail ?? `Server error ${res.status}`)
  return data as T
}

export const getJson = <T>(path: string) => api<T>(path)
export const postJson = <T>(path: string, body: unknown = {}) => api<T>(path, body)

/** Is the server up, and does it have an API key? Never throws. */
export async function hostedStatus(): Promise<HostedStatus> {
  try {
    const h = await api<{ llm: { model: string; api_key_set: boolean }; schemas: string[]; rag: { chunks_indexed: number } }>('/health')
    return { reachable: true, model: h.llm.model, keySet: h.llm.api_key_set, schemas: h.schemas.length, chunks: h.rag.chunks_indexed }
  } catch {
    return { reachable: false }
  }
}

/** Send an image to the server; the hosted model receives it by id, never as base64 through the browser. */
export async function uploadImage(file: File): Promise<{ image_id: string; url: string }> {
  const form = new FormData()
  form.append('file', file)
  let res: Response
  try {
    res = await fetch(`${API}/upload-image`, { method: 'POST', body: form })
  } catch {
    throw new Error('Images need the local server. Start it (see README) and pick the Hosted model.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail ?? 'Image upload failed. Is the local server running?')
  return { image_id: data.image_id, url: `${API}${data.url}` }
}

/** Notes the server appends to its one universal system prompt. Kept short on purpose. */
const APP_NOTES = `You are running inside the Acme Assistant app. Some of the app's own tools (calculators, finance, IT, networking and more) may also be offered: use them when they fit.
If the message ends with [Attached files: ...], work from those files: tables with profile_dataset, query_dataset and aggregate_dataset; documents with search_knowledge_base, read_document or summarize_document; images with analyze_image.`

/** The app's tools take string arguments; the universal tools take real JSON. */
const asStrings = (args: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(args)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
  )

const toSchema = (t: Tool): OpenAiTool => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    parameters: {
      type: 'object',
      properties: t.parameters,
      required: Object.entries(t.parameters).filter(([, p]) => !p.optional).map(([k]) => k),
    },
  },
})

/** Source chips under the answer, from the server's ChromaDB hits. */
function docSources(result: unknown): Source[] {
  const hits = (result as { results?: { source: string; chunk: number; score: number }[] })?.results ?? []
  return hits.map((h) => ({ id: `${h.source}#${h.chunk}`, title: h.source, score: h.score }))
}

export function createHostedAgent(localTools: Tool[]) {
  let universal: OpenAiTool[] | null = null

  async function respond(
    history: ChatMsg[],
    question: string,
    onTrace: (ev: TraceEvent) => void,
    allowNetwork: boolean,
    attached: Attachment[] = [],
    modelName = 'hosted',
  ): Promise<AgentReply> {
    universal ??= await api<OpenAiTool[]>('/tools/schemas')
    const serverTools = new Set(universal.map((t) => t.function.name))

    // Files in the chat: always offer the browser tools that can read them.
    const forced = [
      ...(attached.some((a) => a.kind === 'table') ? ['profile_dataset', 'query_dataset', 'aggregate_dataset'] : []),
      ...(attached.some((a) => a.kind === 'document') ? ['search_knowledge_base', 'read_document', 'summarize_document'] : []),
    ]
    // In hosted mode the server's schema data and ChromaDB index replace the browser's
    // sample company data and keyword search, so those tools are only offered for attachments.
    const candidates = localTools.filter(
      (t) => forced.includes(t.name) || ((allowNetwork || !t.network) && t.category !== 'Company data' && t.category !== 'Knowledge'),
    )
    const routed = selectTools(candidates, question, 3, forced)
    const tools = [...universal, ...routed.map(toSchema)]
    const offered = tools.map((t) => t.function.name)

    const trace: TraceEvent[] = []
    const emit = (ev: Omit<TraceEvent, 'timestamp'>) => {
      const e = { ...ev, timestamp: new Date().toISOString() }
      trace.push(e)
      onTrace(e)
    }

    const imageIds = attached.filter((a) => a.kind === 'image').map((a) => a.ref)
    if (imageIds.length) emit({ type: 'image_attached', text: imageIds.join(', ') })
    const messages: Record<string, unknown>[] = [
      ...history.slice(-8).map((m) => ({ ...m })),
      { role: 'user', content: question, ...(imageIds.length ? { image_ids: imageIds } : {}) },
    ]
    const calls: ToolCall[] = []
    const sources = new Map<string, Source>()
    const done = (text: string): AgentReply => ({ text, calls, sources: [...sources.values()], offered, model: `${modelName} (hosted)`, trace })

    for (let step = 1; step <= MAX_STEPS; step++) {
      const t0 = performance.now()
      const turn = await api<ModelTurn>('/llm/chat', { messages, tools, app_instructions: APP_NOTES })
      emit({ type: 'llm_call', iteration: step, ms: Math.round(performance.now() - t0), requested: turn.tool_calls.map((c) => c.name) })
      if (!turn.tool_calls.length) return done(turn.content)

      messages.push({
        role: 'assistant',
        content: turn.content,
        tool_calls: turn.tool_calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
      })
      for (const c of turn.tool_calls) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(c.arguments || '{}')
        } catch {
          /* invalid JSON from the model: the tool reports the missing arguments */
        }
        const ranIn = serverTools.has(c.name) ? 'server' : 'browser'
        emit({ type: 'tool_call', name: c.name, args, ranIn })

        const t1 = performance.now()
        let result: unknown
        if (ranIn === 'server') {
          result = await api(`/tools/${c.name}`, args).catch((e: Error) => ({ error: e.message }))
        } else {
          const tool = routed.find((t) => t.name === c.name)
          try {
            result = tool ? await tool.run(asStrings(args)) : `Unknown or unavailable tool: ${c.name}`
          } catch (e) {
            result = `Tool error: ${(e as Error).message}`
          }
        }
        const isRag = c.name === 'search_documents'
        emit({ type: isRag ? 'retrieval' : 'tool_result', name: c.name, result, ms: Math.round(performance.now() - t1), ranIn })
        if (isRag) for (const s of docSources(result)) sources.set(s.id, s)

        const text = typeof result === 'string' ? result : JSON.stringify(result)
        calls.push({ tool: c.name, args: asStrings(args), result: text })
        messages.push({ role: 'tool', tool_call_id: c.id, content: text.slice(0, MAX_TOOL_RESULT) })
      }
    }
    // Step budget used up: one last turn without tools forces an answer from what was found.
    const last = await api<ModelTurn>('/llm/chat', {
      messages: [...messages, { role: 'user', content: 'Tool budget reached. Answer now with what you have.' }],
      app_instructions: APP_NOTES,
    })
    return done(last.content)
  }

  return { respond }
}

import type { Message, ToolCall as OllamaToolCall } from 'ollama/browser'
import { ollama } from './ollama'
import { toSources } from './rag'
import type { Source } from './rag'
import { selectTools } from './router'
import { createTools } from './tools'
import { smartRetrieve } from './tools/knowledge'
import type { ToolCall, ToolContext } from './tools'
import type { AgentReply } from './agent'
import type { Attachment } from './files'
import { aboutOtherProduct } from './help'

/** The model used for a reply. Built from what Ollama reports about each installed model. */
export interface ModelOption {
  /** Ollama model tag, as used by `ollama pull`. */
  id: string
  /** Qwen3.x-style models "think" before answering; we switch that off to keep replies fast. */
  thinking: boolean
  /** Models without tool support still chat, but cannot use the tools. */
  tools: boolean
}

/** Starting model; override with VITE_OLLAMA_MODEL in .env.local. Switch any time from the header. */
export const DEFAULT_MODEL: string = import.meta.env.VITE_OLLAMA_MODEL ?? 'qwen2.5:3b'

/** Picker value that turns the AI model off and uses the basic rule-based agent. */
export const OFFLINE = 'offline'

/** Ideas shown in the Models tab. Any tag from the Ollama library can also be typed in. */
export const SUGGESTED_MODELS = [
  { id: 'qwen2.5:3b', note: '1.9 GB, fast, good at tools' },
  { id: 'llama3.2:3b', note: '2 GB, small and quick' },
  { id: 'qwen2.5:7b', note: '4.7 GB, smarter, needs more RAM' },
  { id: 'qwen3.5:9b', note: '5.6 GB, tight on 8 GB RAM' },
]

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

/** Ask Ollama to free a model from RAM right away (used when switching models). */
export async function unloadModel(id: string): Promise<void> {
  try {
    await ollama.chat({ model: id, messages: [], keep_alive: 0 })
  } catch {
    /* not loaded, or Ollama is down: nothing to free */
  }
}

const AREAS: Record<string, string> = {
  erp: 'ERP',
  pos: 'POS',
  biz: 'business',
  fin: 'finance',
  it: 'IT',
  net: 'networking',
  gen: 'general skills',
}

/** A short description of the knowledge base: lesson areas plus other document titles (kept brief for small models). */
function describeDocs(docs: ToolContext['docs']): string {
  const areas = new Set<string>()
  const other: string[] = []
  for (const d of docs) {
    const prefix = d.id.split('-')[0]
    if (d.id.includes('-') && AREAS[prefix]) areas.add(AREAS[prefix])
    else other.push(d.title)
  }
  const shown = other.slice(0, 12).join('; ')
  return `Lessons and guides on: ${[...areas].join(', ')}. Other documents: ${shown}${other.length > 12 ? ` and ${other.length - 12} more` : ''}.`
}

function systemPrompt(docs: ToolContext['docs']) {
  return `You are Acme Assistant, a helpful, knowledgeable assistant for Acme Corp employees. Be concise and professional.
- Use the provided tools whenever they fit the request. Never invent tool results, employee, stock, sales or policy data; if a tool finds nothing, say so.
- People, products, stock, sales and imported data tables: use the data tools (lookup_employee, check_inventory, sales_summary, query_dataset, aggregate_dataset), not the knowledge base.
- For policies, procedures, IT help and company knowledge, search the knowledge base first and cite passages like [leave-policy#1]. ${describeDocs(docs)}
- Users can send you files with the paperclip button (or by dropping them in the chat): CSV, Excel, PDF, Word, PowerPoint, JSON and text. Attached tables are searchable and can be totalled; attached documents are searchable and cited. If asked whether they can send data or files, say yes and explain this.
- If the user's message ends with [Attached files: ...], work from those files: analyse tables with profile_dataset, query_dataset and aggregate_dataset, and read documents with search_knowledge_base, read_document or summarize_document. Never guess at their contents.
- Questions about other products or companies (Claude, ChatGPT, etc.) are general-knowledge questions: answer briefly from what you know, say plainly if you are unsure, and do not describe your own tools unless asked about them.
- Greetings and general-knowledge questions can be answered directly without tools.`
}

export function createLlmAgent(ctx: ToolContext) {
  const tools = createTools(ctx)
  const system = systemPrompt(ctx.docs)

  /**
   * `onText` receives the full answer text so far, for live streaming in the UI.
   * Only a few routed tools are sent to the model per question, which keeps the
   * prompt small (less RAM, faster) and the choice easier for a small model.
   */
  async function respond(
    history: ChatMsg[],
    question: string,
    onText: (text: string) => void,
    allowNetwork: boolean,
    model: ModelOption,
    attached: Attachment[] = [],
  ): Promise<AgentReply> {
    // Files in the chat: always offer the tools that can read them.
    const forced = [
      'search_knowledge_base',
      ...(attached.some((a) => a.kind === 'table') ? ['profile_dataset', 'query_dataset', 'aggregate_dataset'] : []),
      ...(attached.some((a) => a.kind === 'document') ? ['read_document', 'summarize_document'] : []),
    ]
    const usable = tools.filter((t) => allowNetwork || !t.network)
    // A question about another product (Claude, ChatGPT...) is general knowledge. Our documents and our own tool
    // list cannot help, and offering them makes a small model search them anyway, so only Wikipedia is offered.
    const offeredTools = aboutOtherProduct(question)
      ? usable.filter((t) => t.name === 'wikipedia')
      : selectTools(usable, question, 3, forced)
    const schemas = offeredTools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: t.parameters,
          required: Object.entries(t.parameters)
            .filter(([, p]) => !p.optional)
            .map(([k]) => k),
        },
      },
    }))
    const offered = offeredTools.map((t) => t.name)

    const messages: Message[] = [
      { role: 'system', content: system },
      ...history.slice(-8),
      { role: 'user', content: question },
    ]
    const calls: ToolCall[] = []
    const sources = new Map<string, Source>()

    for (let step = 0; step < 5; step++) {
      const stream = await ollama.chat({
        model: model.id,
        messages,
        ...(model.tools ? { tools: schemas } : {}),
        stream: true,
        ...(model.thinking ? { think: false } : {}),
        keep_alive: '5m', // unload the model from RAM after 5 idle minutes
        options: { num_ctx: 4096 },
      })

      let content = ''
      const requested: OllamaToolCall[] = []
      for await (const part of stream) {
        if (part.message.content) {
          content += part.message.content
          onText(content)
        }
        if (part.message.tool_calls) requested.push(...part.message.tool_calls)
      }

      if (!requested.length) return { text: content, calls, sources: [...sources.values()], offered, model: model.id }

      onText('')
      messages.push({ role: 'assistant', content, tool_calls: requested })

      for (const c of requested) {
        const tool = offeredTools.find((t) => t.name === c.function.name)
        const args = Object.fromEntries(
          Object.entries(c.function.arguments)
            .filter(([, v]) => v !== null && v !== undefined && !/^(null|undefined)$/i.test(String(v)))
            .map(([k, v]) => [k, String(v)]),
        )
        let result: string
        try {
          result = tool ? await tool.run(args) : `Unknown or unavailable tool: ${c.function.name}`
        } catch (e) {
          result = `Tool error: ${(e as Error).message}`
        }
        calls.push({ tool: c.function.name, args, result })
        if (c.function.name === 'search_knowledge_base') {
          const { hits } = await smartRetrieve(ctx, args.query, args.document)
          for (const s of toSources(hits)) sources.set(s.id, s)
        }
        messages.push({ role: 'tool', tool_name: c.function.name, content: result })
      }
    }
    return { text: 'Stopped after too many tool steps.', calls, sources: [...sources.values()], offered, model: model.id }
  }

  return { tools, respond }
}

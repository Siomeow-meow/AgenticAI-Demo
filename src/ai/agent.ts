import type { TraceEvent } from './hosted'
import { retrieveHybrid, toSources } from './rag'
import type { Source } from './rag'
import { createTools } from './tools'
import type { ToolCall, ToolContext } from './tools'

export interface AgentReply {
  text: string
  calls: ToolCall[]
  sources: Source[]
  /** Names of the tools the router offered to the model for this question. */
  offered?: string[]
  /** Ollama model that wrote the answer (absent for the basic rule-based agent). */
  model?: string
  /** Hosted model only: every step of the agent's work, for the AI Trace panel. */
  trace?: TraceEvent[]
}

/** Pick the sentences from a chunk that best overlap with the query. */
function bestSentences(text: string, query: string, n = 2): string {
  const q = new Set(query.toLowerCase().match(/[a-z0-9]+/g))
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+/g) ?? [text]
  return sentences
    .map((s, order) => ({
      s: s.trim(),
      order,
      score: (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 3 && q.has(w)).length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .sort((a, b) => a.order - b.order)
    .map((x) => x.s)
    .join(' ')
}

/**
 * Offline fallback agent (no LLM): picks a tool with keyword rules and
 * composes the answer from the tool's result. Only tools that define `match`
 * work here; the rest need the AI model.
 */
export function createAgent(ctx: ToolContext) {
  const tools = createTools(ctx)
  const ordered = [
    ...tools.filter((t) => t.name !== 'search_knowledge_base'),
    ...tools.filter((t) => t.name === 'search_knowledge_base'),
  ]

  async function respond(message: string): Promise<AgentReply> {
    for (const tool of ordered) {
      const args = tool.match?.(message)
      if (!args) continue

      const result = await tool.run(args)
      const calls: ToolCall[] = [{ tool: tool.name, args, result }]

      if (tool.name !== 'search_knowledge_base') {
        return { text: result, calls, sources: [] }
      }

      const hits = await retrieveHybrid(ctx.index, message, { semantic: ctx.semantic, minScore: 0.16 }) // stricter: this agent cannot judge relevance itself
      if (!hits.length) {
        return { text: "I couldn't find anything relevant in the knowledge base. For general questions, start Ollama and pick a model in the top bar.", calls, sources: [] }
      }
      const text = hits
        .slice(0, 2)
        .map((h) => `${bestSentences(h.chunk.text, message)} [${h.chunk.id}]`)
        .join('\n\n')
      return { text, calls, sources: toSources(hits) }
    }
    return { text: 'No tool matched.', calls: [], sources: [] }
  }

  return { tools, respond }
}

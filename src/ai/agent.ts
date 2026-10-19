import type { Attachment } from './files'
import type { Source } from './rag'
import type { ToolCall } from './tools'

/** Timing of one reply, so slow answers can be explained (shown under the reply). */
export interface ReplyStats {
  /** Time until the first word (or the first tool request) appeared, in seconds. */
  firstSec: number
  totalSec: number
  /** Tokens the model read (instructions, tools, history, question) and wrote, over all its rounds. */
  promptTokens: number
  outTokens: number
  /** Writing speed. */
  tokensPerSec: number
  /** Seconds spent loading the model into memory. */
  loadSec: number
  /** Context window used. */
  ctx: number
  /** Share of the model in GPU memory (0 to 1), or null if unknown. */
  gpu: number | null
}

/** What the assistant returns for one question. */
export interface AgentReply {
  text: string
  calls: ToolCall[]
  sources: Source[]
  /** Names of the tools the router offered to the model for this question. */
  offered?: string[]
  /** Ollama model that wrote the answer. */
  model?: string
  stats?: ReplyStats
  /** The steps planned before working on a multi-step request. */
  plan?: string[]
  /** Whether the answer was checked against the tool results: fine as written, or rewritten after the check found a problem. */
  check?: 'ok' | 'revised'
  /** The user pressed Stop before the reply was finished. */
  stopped?: boolean
}

/** One question and its answer in a conversation. */
export interface Turn {
  question: string
  reply: AgentReply
  attachments?: Attachment[]
}

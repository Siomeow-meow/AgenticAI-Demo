import type { Source } from './rag'
import type { ToolCall } from './tools'

/** What the assistant returns for one question. */
export interface AgentReply {
  text: string
  calls: ToolCall[]
  sources: Source[]
  /** Names of the tools the router offered to the model for this question. */
  offered?: string[]
  /** Ollama model that wrote the answer. */
  model?: string
}

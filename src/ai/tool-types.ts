import type { SourceDoc } from './documents'
import type { Index, Semantic } from './rag'

export interface ToolParam {
  type: string
  description: string
  optional?: boolean
}

/** Something a tool found that the user can choose to save into the knowledge base. */
export interface Learnable {
  title: string
  text: string
  source: string
}

export interface Tool {
  name: string
  category: string
  description: string
  /** Extra words used only by the router to decide when this tool is relevant. */
  keywords: string
  /** Extra routing words computed from live data (names, products, column headers) each time a question is routed. */
  dynamicKeywords?: () => string
  /** If the question matches this pattern the router always offers the tool (for cases keywords miss, like "15% of 200"). */
  trigger?: RegExp
  /** JSON-schema properties sent to the LLM for native tool calling. */
  parameters: Record<string, ToolParam>
  /** True if the tool calls an external web service (can be switched off). */
  network?: boolean
  /** Needs the user's approval before it runs (it changes something outside the chat). A function decides per call. */
  confirm?: boolean | ((args: Record<string, string>) => boolean)
  /** One line describing what a call will do, shown in the approval dialog. */
  describe?: (args: Record<string, string>) => string
  /** If the result is worth keeping, describe it so the UI can offer "Save to knowledge". */
  learn?: (args: Record<string, string>, result: string) => Learnable | null
  run: (args: Record<string, string>) => string | Promise<string>
}

export interface ToolCall {
  tool: string
  args: Record<string, string>
  result: string
}

export interface ToolContext {
  index: Index
  docs: SourceDoc[]
  /** Present when semantic search is switched on and ready. */
  semantic?: Semantic | null
}

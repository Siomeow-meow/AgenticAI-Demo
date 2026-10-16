import { ollama } from './ollama'

/**
 * Lets tools make their own one-off model calls (query rewriting, grading passages, summaries,
 * reading images) with whichever model the chat is currently using. Set by the chat agent.
 */
interface Active {
  id: string
  thinking: boolean
}

let active: Active | null = null

/** Runtime switches shared with tools (set by the chat agent for each question). */
export const runtime = { network: false }

export function setGenerateModel(model: Active | null) {
  active = model
}

/** True when a model is available for tools that want to ask one (false in Basic mode). */
export const canGenerate = () => active !== null

interface Options {
  system?: string
  /** Ask for a JSON reply. */
  json?: boolean
  /** Base64 images for a vision model. */
  images?: string[]
  /** Use this model instead of the chat model (for example a vision model). */
  model?: string
  maxTokens?: number
}

/** One non-streaming model call. Throws when no model is available. */
export async function generate(prompt: string, opts: Options = {}): Promise<string> {
  const model = opts.model ?? active?.id
  if (!model) throw new Error('No AI model is selected (Basic mode).')
  const res = await ollama.chat({
    model,
    messages: [
      ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
      { role: 'user' as const, content: prompt, ...(opts.images ? { images: opts.images } : {}) },
    ],
    stream: false,
    ...(opts.json ? { format: 'json' as const } : {}),
    ...(active?.thinking && !opts.model ? { think: false } : {}),
    keep_alive: '5m',
    options: { num_ctx: 4096, temperature: 0.2, ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}) },
  })
  return res.message.content.trim()
}

/** Like generate(), but returns null instead of throwing (for optional steps that can be skipped). */
export async function tryGenerate(prompt: string, opts: Options = {}): Promise<string | null> {
  if (!active && !opts.model) return null
  try {
    return await generate(prompt, opts)
  } catch {
    return null
  }
}

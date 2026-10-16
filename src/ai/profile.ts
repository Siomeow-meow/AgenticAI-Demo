/**
 * Model profiles: how the agent is tuned for the model that is actually installed.
 * Small models get a short context, few tools and no reasoning (they get confused and slow otherwise).
 * Bigger models get a longer context, more tools per question, more steps and reasoning for hard questions.
 */

export type Tier = 'small' | 'medium' | 'large'
export type ProfileChoice = 'auto' | Tier

export interface ModelProfile {
  tier: Tier
  /** Context window sent to Ollama (tokens). */
  numCtx: number
  /** How many routed tools are shown to the model per question. */
  tools: number
  /** Most model-and-tool rounds in one answer. */
  steps: number
  /** How many earlier chat messages are sent word for word (older ones are summarized). */
  history: number
  /** Passages returned by knowledge searches. */
  ragK: number
  /** Longest tool result (characters) kept in the conversation. */
  resultChars: number
  /** Whether a thinking model may reason before answering: never, or only on hard questions. */
  reasoning: 'off' | 'auto'
}

/** What the agent learns about a model from Ollama. */
export interface ModelFacts {
  name: string
  sizeGB: number
  /** Parameters in billions, or null when Ollama did not say. */
  paramsB: number | null
  /** Largest context the model supports, or null when unknown. */
  contextLength: number | null
  thinking: boolean
}

const TIERS: Record<Tier, ModelProfile> = {
  small: { tier: 'small', numCtx: 4096, tools: 3, steps: 5, history: 6, ragK: 3, resultChars: 3000, reasoning: 'off' },
  medium: { tier: 'medium', numCtx: 8192, tools: 5, steps: 6, history: 8, ragK: 4, resultChars: 6000, reasoning: 'off' },
  large: { tier: 'large', numCtx: 16384, tools: 8, steps: 10, history: 12, ragK: 5, resultChars: 12000, reasoning: 'auto' },
}

/** Parameter count in billions: from Ollama's number, else a guess from the download size (4-bit models are about 0.6 GB per billion). */
function sizeInBillions(f: ModelFacts): number {
  return f.paramsB ?? Math.max(0.5, f.sizeGB / 0.6)
}

export function tierFor(f: ModelFacts): Tier {
  const b = sizeInBillions(f)
  return b <= 4.5 ? 'small' : b <= 16 ? 'medium' : 'large'
}

/** The profile for a model: automatic from its size by default, or a tier picked by hand. */
export function profileFor(f: ModelFacts, choice: ProfileChoice = 'auto'): ModelProfile {
  const base = TIERS[choice === 'auto' ? tierFor(f) : choice]
  // Never ask for more context than the model supports.
  const numCtx = f.contextLength ? Math.max(2048, Math.min(base.numCtx, f.contextLength)) : base.numCtx
  return { ...base, numCtx }
}

/** Does this question look hard enough to be worth the extra time of reasoning? */
export function isHardQuestion(question: string): boolean {
  const words = question.trim().split(/\s+/).length
  return (
    words > 30 ||
    /\b(why|explain|compare|analy[sz]e|research|derive|prove|calculate|solve|plan|design|evaluate|trade-?offs?|step by step|pros and cons|difference between)\b/i.test(question)
  )
}

export const describeProfile = (p: ModelProfile) =>
  `${p.tier} · ${p.numCtx.toLocaleString('en-US')} token context · ${p.tools} tools per question · up to ${p.steps} steps${p.reasoning === 'auto' ? ' · reasons on hard questions' : ''}`

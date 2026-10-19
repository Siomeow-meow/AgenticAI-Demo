/**
 * Model profiles: how the agent is tuned for the model that is actually installed.
 * Small models get a short context, few tools and no reasoning (they get confused and slow otherwise).
 * Bigger models get a longer context, more tools per question, more steps and reasoning for hard questions.
 */

export type Tier = 'small' | 'medium' | 'large'
export type ProfileChoice = 'auto' | Tier

export interface ModelProfile {
  tier: Tier
  /** Context window sent to Ollama (tokens). Lowered automatically when the model would not fit in GPU memory at the wanted size. */
  numCtx: number
  /** The context window this profile asks for, before any lowering. */
  wantCtx: number
  /** How many routed tools are shown to the model per question. */
  tools: number
  /** Most model-and-tool rounds in one answer. */
  steps: number
  /** Most earlier chat messages sent (fewer if they do not fit the context window; the rest are summarized). */
  history: number
  /** Passages returned by knowledge searches. */
  ragK: number
  /** Longest tool result (characters) kept in the conversation. */
  resultChars: number
  /** Whether a thinking model may reason before answering: never, or only on hard questions. */
  reasoning: 'off' | 'auto'
  /** Write a short plan first for requests that need several steps (one extra model call). */
  planning: boolean
  /** Check an answer that used tools against the tool results before showing it (one extra model call). */
  verify: boolean
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

const TIERS: Record<Tier, Omit<ModelProfile, 'wantCtx'>> = {
  small: { tier: 'small', numCtx: 8192, tools: 3, steps: 5, history: 12, ragK: 3, resultChars: 3000, reasoning: 'off', planning: false, verify: false },
  medium: { tier: 'medium', numCtx: 16384, tools: 5, steps: 6, history: 16, ragK: 4, resultChars: 6000, reasoning: 'off', planning: true, verify: true },
  large: { tier: 'large', numCtx: 32768, tools: 8, steps: 10, history: 24, ragK: 5, resultChars: 12000, reasoning: 'auto', planning: true, verify: true },
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
  const want = f.contextLength ? Math.max(2048, Math.min(base.numCtx, f.contextLength)) : base.numCtx
  return { ...base, wantCtx: want, numCtx: fittedCtx(f.name, want) ?? want }
}

// ---------- Fitting the context window to the machine ----------
// A bigger window needs more memory. If the model plus its window does not fit in GPU memory, part of it runs on the CPU
// and everything becomes several times slower. The app tests this once per model and remembers the largest window that fits.

const FIT_KEY = 'acme-assistant-ctx-fit'
type FitMap = Record<string, { want: number; ctx: number }>

function readFits(): FitMap {
  try {
    return JSON.parse(localStorage.getItem(FIT_KEY) ?? '{}') as FitMap
  } catch {
    return {}
  }
}

/** The window that was found to fit for this model when this size was wanted, or null if it has not been tested. */
export function fittedCtx(name: string, want: number): number | null {
  const hit = readFits()[name]
  return hit && hit.want === want ? hit.ctx : null
}

export function saveFit(name: string, want: number, ctx: number): void {
  try {
    localStorage.setItem(FIT_KEY, JSON.stringify({ ...readFits(), [name]: { want, ctx } }))
  } catch {
    /* storage unavailable: the test just runs again next time */
  }
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
  `${p.tier} · ${p.numCtx.toLocaleString('en-US')} token context · ${p.tools} tools per question · up to ${p.steps} steps${p.reasoning === 'auto' ? ' · reasons on hard questions' : ''}${p.planning ? ' · plans multi-step requests' : ''}${p.verify ? ' · checks its answers' : ''}`

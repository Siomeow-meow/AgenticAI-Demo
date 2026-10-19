import { tryGenerate } from './generate'
import type { ToolCall } from './tool-types'

/**
 * Two extra steps that make an agent more than a chatbot with tools:
 *  - planning: split a request that needs several steps into an ordered list before starting
 *  - checking: compare the finished answer with what the tools actually returned, and fix it if it disagrees
 */

const VERBS = /\b(calculate|compute|search|find|look ?up|write|create|draft|email|remind|compare|summari[sz]e|save|export|convert|research|analy[sz]e|list|check|assign|schedule|translate|plot|explain)\b/gi

/** Does this request look like it needs several steps? */
export function needsPlan(question: string): boolean {
  if (/\b(step by step|and then|then|after that|afterwards|first\b.*\bthen|as well as|and also|plan)\b/i.test(question)) return question.split(/\s+/).length >= 8
  const verbs = new Set((question.match(VERBS) ?? []).map((v) => v.toLowerCase()))
  return verbs.size >= 3
}

/** An ordered list of at most 5 short steps, or null when no model is available or it did not answer usefully. */
export async function makePlan(question: string): Promise<string[] | null> {
  const out = await tryGenerate(
    `Break this request into 2 to 5 short, concrete steps in the order they should be done. Each step is one action, such as looking something up, calculating, comparing, or writing something. Reply as JSON: {"steps":["...","..."]}\n\nRequest: ${question.slice(0, 600)}`,
    { json: true, maxTokens: 200 },
  )
  if (!out) return null
  try {
    const steps = (JSON.parse(out) as { steps?: unknown }).steps
    if (!Array.isArray(steps)) return null
    const clean = steps.filter((s): s is string => typeof s === 'string' && s.trim().length > 2).map((s) => s.trim().slice(0, 120)).slice(0, 5)
    return clean.length >= 2 ? clean : null
  } catch {
    return null
  }
}

/** The plan as text for the model's instructions. */
export const planPrompt = (steps: string[]) =>
  `Plan for this request. Work through it in order, using tools for each step that needs one, then finish with ONE combined answer:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`

/**
 * Is the answer consistent with the tool results? Only contradictions and invented facts count, so a correct answer is never
 * "improved". Returns a short description of the problem, or null when it looks fine (or the check could not run).
 */
export async function findProblem(question: string, calls: ToolCall[], answer: string): Promise<string | null> {
  const results = calls
    .filter((c) => c.result)
    .map((c) => `${c.tool}: ${c.result.replace(/\s+/g, ' ').slice(0, 500)}`)
    .join('\n')
    .slice(0, 2500)
  if (!results) return null
  const out = await tryGenerate(
    `You are checking an assistant's answer.\n\nQuestion: ${question.slice(0, 400)}\n\nWhat the tools returned:\n${results}\n\nAnswer:\n${answer.slice(0, 1500)}\n\nDoes the answer contradict the tool results, or state numbers or facts that are not in them? Do not judge style or completeness. Reply as JSON: {"ok":true} or {"ok":false,"problem":"one short sentence"}`,
    { json: true, maxTokens: 80 },
  )
  if (!out) return null
  try {
    const r = JSON.parse(out) as { ok?: unknown; problem?: unknown }
    return r.ok === false && typeof r.problem === 'string' && r.problem.trim() ? r.problem.trim().slice(0, 200) : null
  } catch {
    return null
  }
}

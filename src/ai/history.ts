import type { ChatMsg } from './llm'
import type { ToolCall } from './tool-types'

/**
 * Keeping a conversation inside the model's context window without silently losing the start of it.
 * Recent messages are sent as written (older ones are shortened), whatever does not fit is turned into a short summary,
 * and facts that tools returned are kept next to the answer that used them.
 */

/** Rough token count (about 3.5 characters per token for English text and code). */
export const approxTokens = (s: string) => Math.ceil(s.length / 3.5)

const short = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat
}

/** What tools returned in one turn, as short lines, so later questions ("email her", "and double that") still have the facts. */
export function compactCalls(calls: ToolCall[]): string {
  const notes = calls
    .filter((c) => c.result && !/^(Unknown|Tool error)/.test(c.result))
    .slice(0, 5)
    .map((c) => {
      const args = Object.entries(c.args)
        .slice(0, 3)
        .map(([k, v]) => `${k}=${short(String(v), 40)}`)
        .join(', ')
      return `${c.tool}(${args}) gave: ${short(c.result, 160)}`
    })
  return notes.join('\n')
}

/** Replace code blocks with a placeholder and cut the text short: old replies keep their meaning, not their length. */
function shrink(text: string, limit: number): string {
  const noCode = text.replace(/```(\w*)[^\n]*\n([\s\S]*?)(?:```|$)/g, (_m, lang: string, body: string) => `[${lang || 'code'} code block omitted, ${body.split('\n').length} lines]`)
  return noCode.length > limit ? `${noCode.slice(0, limit)}… [shortened]` : noCode
}

/**
 * The newest messages that fit in `budget` tokens. The last `keepFull` messages are kept whole; older ones are shortened.
 * `dropped` is everything before them (to be summarised).
 */
export function fitHistory(history: ChatMsg[], budget: number, keepFull = 2): { recent: ChatMsg[]; dropped: ChatMsg[] } {
  const kept: ChatMsg[] = []
  let used = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    const full = history.length - 1 - i < keepFull
    const content = full ? m.content : shrink(m.content, m.role === 'user' ? 600 : 700)
    const cost = approxTokens(content) + 6
    // Always keep the latest message, even if it alone is large.
    if (kept.length && used + cost > budget) break
    kept.push({ role: m.role, content, ...(m.facts ? { facts: m.facts } : {}) })
    used += cost
  }
  kept.reverse()
  return { recent: kept, dropped: history.slice(0, history.length - kept.length) }
}

/** A summary built without the model (instant): what was asked and, briefly, what the answer was. */
export function extractiveSummary(dropped: ChatMsg[]): string {
  const lines: string[] = []
  for (let i = 0; i < dropped.length; i++) {
    const m = dropped[i]
    if (m.role !== 'user') continue
    const reply = dropped[i + 1]?.role === 'assistant' ? ` → ${short(shrink(dropped[i + 1].content, 300), 140)}` : ''
    lines.push(`- Asked: ${short(m.content, 110)}${reply}`)
  }
  return lines.slice(-14).join('\n')
}

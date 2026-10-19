import { runtime } from './generate'
import type { Tool } from './tool-types'

/**
 * Approval before actions that change something outside the chat (writing files, posting to a webhook, calling an API
 * with POST, deleting memory). The app shows a dialog; tools are never run until it is answered.
 *
 * Prompt-injection guard: once an answer has read web pages or documents ("tainted"), a hidden instruction in that text
 * could try to make the assistant do something. From then on every risky action asks again, even if the user chose
 * "always allow", and the dialog says why.
 */

export interface ApprovalRequest {
  tool: string
  summary: string
  args: Record<string, string>
  /** Shown when the request came after reading web or document text. */
  warning?: string
}

export type ApprovalAnswer = 'once' | 'always' | 'deny'

export const approvals = {
  /** Set by the app: shows the dialog and resolves with the user's choice. */
  ask: null as null | ((req: ApprovalRequest) => Promise<ApprovalAnswer>),
  /** Tools the user allowed for the rest of this session. */
  always: new Set<string>(),
  /** Used by the evaluation runner: approve safe requests without asking (tainted ones are still refused). */
  auto: false,
}

/** The evaluation runner turns this on while it runs and off again afterwards. */
export function setAutoApprove(on: boolean): void {
  approvals.auto = on
}

export function needsApproval(tool: Tool, args: Record<string, string>): boolean {
  return typeof tool.confirm === 'function' ? tool.confirm(args) : tool.confirm === true
}

/** Tools whose results are text from outside the assistant: the web and the documents. */
export function producesUntrustedText(tool: Tool): boolean {
  return !!tool.network || tool.category === 'Knowledge'
}

/** Returns null when the tool may run, or a message to give the model instead when it may not. */
export async function guard(tool: Tool, args: Record<string, string>): Promise<string | null> {
  if (!needsApproval(tool, args)) return null
  const tainted = runtime.tainted
  if (approvals.auto) return tainted ? `${tool.name} was refused: it was requested after reading web or document text.` : null
  if (!tainted && approvals.always.has(tool.name)) return null
  if (!approvals.ask) return `${tool.name} needs the user's approval, and no approval dialog is available.`

  const summary = tool.describe?.(args) ?? `${tool.name}(${Object.entries(args).map(([k, v]) => `${k}=${v.slice(0, 60)}`).join(', ')})`
  const answer = await approvals.ask({
    tool: tool.name,
    summary,
    args,
    ...(tainted ? { warning: 'This was requested after reading web or document text, which can contain hidden instructions. Only approve it if it is what you asked for.' } : {}),
  })
  if (answer === 'deny') return 'The user declined this action. Do not try it again; tell the user it was not done.'
  if (answer === 'always' && !tainted) approvals.always.add(tool.name)
  return null
}

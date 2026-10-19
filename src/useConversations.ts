import { useCallback, useMemo } from 'react'
import type { Turn } from './ai/agent'
import { useLocalStorage } from './useLocalStorage'

/** A saved chat. */
export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  turns: Turn[]
}

interface State {
  activeId: string
  items: Conversation[]
}

const KEY = 'acme-assistant-conversations'
const LEGACY_KEY = 'acme-assistant-chat'
const MAX_CONVERSATIONS = 60
export const DEFAULT_TITLE = 'New chat'

const newId = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

function blank(): Conversation {
  const now = Date.now()
  return { id: newId(), title: DEFAULT_TITLE, createdAt: now, updatedAt: now, turns: [] }
}

/** The title of a chat comes from its first question. */
export function titleFrom(question: string): string {
  const t = question.replace(/\s+/g, ' ').trim()
  return t.length > 46 ? `${t.slice(0, 45)}…` : t || DEFAULT_TITLE
}

/** Start from the single chat older versions of the app kept, so nothing is lost. */
function initialState(): State {
  const first = blank()
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    const turns = raw ? (JSON.parse(raw) as Turn[]) : []
    if (Array.isArray(turns) && turns.length) {
      first.turns = turns
      first.title = titleFrom(turns[0].question)
    }
  } catch {
    /* no old chat to bring over */
  }
  return { activeId: first.id, items: [first] }
}

/** Several saved chats, with the active one's turns as the working copy. */
export function useConversations() {
  const [state, setState] = useLocalStorage<State>(KEY, initialState())

  const active = useMemo(() => state.items.find((c) => c.id === state.activeId) ?? state.items[0], [state])

  /** Replace the active chat's turns (a new list, or a function of the current one). */
  const setTurns = useCallback(
    (next: Turn[] | ((turns: Turn[]) => Turn[])) =>
      setState((s) => {
        const cur = s.items.find((c) => c.id === s.activeId) ?? s.items[0]
        const turns = typeof next === 'function' ? next(cur.turns) : next
        const title = cur.title === DEFAULT_TITLE && turns.length ? titleFrom(turns[0].question) : cur.title
        return { ...s, items: s.items.map((c) => (c.id === cur.id ? { ...c, turns, title, updatedAt: Date.now() } : c)) }
      }),
    [setState],
  )

  const newChat = useCallback(
    () =>
      setState((s) => {
        const cur = s.items.find((c) => c.id === s.activeId)
        if (cur && !cur.turns.length) return s // already on an empty chat
        const fresh = blank()
        return { activeId: fresh.id, items: [fresh, ...s.items].slice(0, MAX_CONVERSATIONS) }
      }),
    [setState],
  )

  const select = useCallback((id: string) => setState((s) => (s.items.some((c) => c.id === id) ? { ...s, activeId: id } : s)), [setState])

  const remove = useCallback(
    (id: string) =>
      setState((s) => {
        const items = s.items.filter((c) => c.id !== id)
        if (!items.length) {
          const fresh = blank()
          return { activeId: fresh.id, items: [fresh] }
        }
        return { activeId: s.activeId === id ? items[0].id : s.activeId, items }
      }),
    [setState],
  )

  const rename = useCallback(
    (id: string, title: string) => setState((s) => ({ ...s, items: s.items.map((c) => (c.id === id ? { ...c, title: title.trim() || c.title } : c)) })),
    [setState],
  )

  return { turns: active.turns, active, items: state.items, setTurns, newChat, select, remove, rename }
}

/** A chat as a Markdown document, for saving. */
export function toMarkdown(c: Conversation): string {
  const lines = [`# ${c.title}`, '', `Exported ${new Date().toLocaleString()}`, '']
  for (const t of c.turns) {
    lines.push(`## You`, '', t.question, '', `## Assistant${t.reply.model ? ` (${t.reply.model})` : ''}`, '', t.reply.text || '(no reply)', '')
    if (t.reply.calls.length) lines.push(`_Tools used: ${t.reply.calls.map((x) => x.tool).join(', ')}_`, '')
    if (t.reply.sources.length) lines.push(`_Sources: ${t.reply.sources.map((x) => x.id).join(', ')}_`, '')
  }
  return lines.join('\n')
}

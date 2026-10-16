import { tryGenerate } from '../generate'
import { createStore } from '../store'
import type { Tool } from '../tool-types'
import { fuzzyFind } from './fuzzy'

export interface Memory {
  key: string
  value: string
  savedAt: string
}

/** Long-term facts the assistant was asked to remember. They persist in this browser and are shown to the model every turn. */
export const memoryStore = createStore<Memory[]>('acme-assistant-memory', [])

const clean = (s: string) => s.trim().replace(/\s+/g, ' ')

/** The remembered facts as text for the system prompt (empty when there are none). */
export function memoryPrompt(): string {
  const all = memoryStore.get().slice(-25)
  return all.length ? `\n\nThings you were asked to remember about the user and their work (use them when relevant):\n${all.map((m) => `- ${m.key}: ${m.value}`).join('\n')}` : ''
}

/** Pick the sentences that carry the most frequent content words (a no-model fallback). */
function extractiveSummary(text: string, count: number): string {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+/g) ?? [text]
  if (sentences.length <= count) return sentences.join(' ').trim()
  const freq = new Map<string, number>()
  for (const w of text.toLowerCase().match(/[a-z]{4,}/g) ?? []) freq.set(w, (freq.get(w) ?? 0) + 1)
  return sentences
    .map((s, i) => ({ s: s.trim(), i, score: (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).reduce((a, w) => a + (freq.get(w) ?? 0), 0) / Math.sqrt(s.length) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s)
    .join(' ')
}

export const memoryTools: Tool[] = [
  {
    name: 'remember',
    category: 'Memory & state',
    description: 'Remember a fact long-term (a preference, a name, a decision, a number) so it is available in later chats. Saving the same key again updates it.',
    keywords: 'remember memorize memory save fact preference note that my favorite i am my name is keep in mind store long term dont forget',
    parameters: {
      key: { type: 'string', description: 'Short label, e.g. "manager" or "preferred currency"' },
      value: { type: 'string', description: 'The fact to remember' },
    },
    run: ({ key, value }) => {
      const k = clean(key).toLowerCase()
      if (!k || !clean(value)) return 'Give both a short label and the fact to remember.'
      const all = memoryStore.get()
      const entry: Memory = { key: k, value: clean(value), savedAt: new Date().toLocaleString() }
      memoryStore.set([...all.filter((m) => m.key !== k), entry])
      return `${all.some((m) => m.key === k) ? 'Updated' : 'Remembered'}: ${k} = ${entry.value}`
    },
  },
  {
    name: 'recall',
    category: 'Memory & state',
    description: 'Look up remembered facts. Leave the query empty to list everything remembered.',
    keywords: 'recall remember what did I tell you my what is my do you know about me remembered facts memory lookup earlier told',
    parameters: { query: { type: 'string', description: 'What to look for; empty for all memories', optional: true } },
    run: ({ query = '' }) => {
      const all = memoryStore.get()
      if (!all.length) return 'Nothing has been remembered yet.'
      const q = query.trim()
      const found = !q || /^(all|everything)$/i.test(q) ? all : fuzzyFind(all, q, (m) => `${m.key} ${m.value}`, 8)
      return found.length ? found.map((m) => `${m.key}: ${m.value} (saved ${m.savedAt})`).join('\n') : `Nothing remembered matches "${query}".`
    },
  },
  {
    name: 'forget',
    category: 'Memory & state',
    description: 'Delete one remembered fact by its label.',
    keywords: 'forget delete remove erase clear memory stop remembering wipe',
    parameters: { key: { type: 'string', description: 'The label of the memory to delete' } },
    run: ({ key }) => {
      const k = clean(key).toLowerCase()
      const all = memoryStore.get()
      const hit = all.find((m) => m.key === k) ?? all.find((m) => m.key.includes(k) && k.length > 2)
      if (!hit) return `No memory is labelled "${key}".`
      memoryStore.set(all.filter((m) => m !== hit))
      return `Forgot: ${hit.key}`
    },
  },
  {
    name: 'summarize_text',
    category: 'Memory & state',
    description: 'Summarize a block of text (an article, a long message, meeting notes) into a few sentences or bullet points.',
    keywords: 'summarize summary shorten condense tldr key points recap boil down brief notes meeting article text',
    parameters: {
      text: { type: 'string', description: 'The text to summarize' },
      style: { type: 'string', description: 'bullets (default) or paragraph', optional: true },
    },
    run: async ({ text, style }) => {
      if (text.trim().split(/\s+/).length < 25) return 'That text is already short.'
      const bullets = !/para/i.test(style ?? '')
      const written = await tryGenerate(
        `Summarize the text below ${bullets ? 'as 3 to 6 short bullet points' : 'in one short paragraph'}. Keep names, numbers and decisions exactly.\n\n${text.slice(0, 8000)}`,
        { maxTokens: 250 },
      )
      return written ?? extractiveSummary(text, 3)
    },
  },
]

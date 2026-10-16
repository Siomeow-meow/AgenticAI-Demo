import { tryGenerate, runtime } from '../generate'
import { noteStore, taskStore } from '../data'
import { advancedRetrieve, describeEntity, formatPassages, graphStats, relatedTerms, wikipedia } from '../rag-advanced'
import type { Passage } from '../rag-advanced'
import { tokenize } from '../rag'
import type { Tool, ToolContext } from '../tool-types'
import { searchAllData } from './fuzzy'
import { memoryStore } from './memory'

const short = (s: string, n = 260) => (s.replace(/\s+/g, ' ').length > n ? `${s.replace(/\s+/g, ' ').slice(0, n - 3)}...` : s.replace(/\s+/g, ' '))

export function researchTools(ctx: ToolContext): Tool[] {
  return [
    {
      name: 'research_knowledge_base',
      category: 'Knowledge',
      description:
        'Careful, slower search of the documents for hard or vague questions: rewrites the question, searches with a hypothetical answer, checks each passage is really relevant, retries if nothing fits, and falls back to Wikipedia when allowed. Use when search_knowledge_base finds nothing useful.',
      keywords: 'research thorough careful accurate verify deep search hard question vague not found cannot find rephrase double check reliable',
      parameters: { query: { type: 'string', description: 'The question to research' } },
      run: async ({ query }) => {
        const r = await advancedRetrieve(ctx, query, { k: 4, accurate: true, web: runtime.network })
        const head = `Steps: ${r.steps.join(' → ')}`
        if (r.web) return `${head}\n\nNo relevant document passages. From the web:\n${r.web}`
        return r.passages.length ? `${head}\n\n${formatPassages(r)}` : `${head}\n\nNo relevant information found.`
      },
    },
    {
      name: 'deep_research',
      category: 'Knowledge',
      description:
        'Multi-step research for questions that need several pieces of information: searches, works out what is still missing, searches again (up to 3 rounds) and returns everything found, with the steps taken.',
      keywords: 'deep research multi step multi-hop complex compare combine investigate analyse thoroughly across documents several related connect everything about',
      parameters: { question: { type: 'string', description: 'The complex question to investigate' } },
      run: async ({ question }) => {
        const seen = new Map<string, Passage>()
        const log: string[] = []
        let q = question
        for (let round = 1; round <= 3; round++) {
          const r = await advancedRetrieve(ctx, q, { k: 3 })
          const fresh = r.passages.filter((p) => !seen.has(p.id))
          for (const p of fresh) seen.set(p.id, p)
          log.push(`Round ${round}: searched "${short(q, 80)}" → ${fresh.length} new passage${fresh.length === 1 ? '' : 's'}`)
          if (round === 3) break

          let next: string | null
          const known = [...seen.values()].map((p) => short(p.text, 300)).join('\n')
          const asked = await tryGenerate(
            `Question: ${question}\n\nWhat has been found so far:\n${known || '(nothing yet)'}\n\nWhat specific information is still missing to answer the question fully? Reply with ONE short search query for it, or the single word DONE if nothing is missing.`,
            { maxTokens: 30 },
          )
          if (asked) {
            if (/^\W*done\b/i.test(asked)) {
              log.push('Nothing missing: stopping')
              break
            }
            next = asked.split('\n')[0].replace(/^["'\s]+|["'\s.]+$/g, '').slice(0, 120)
          } else {
            // No model: follow the knowledge graph to a related topic.
            const term = relatedTerms(ctx.index, `${question} ${known}`, 1)[0]
            next = term ? `${question} ${term}` : null
          }
          if (!next || next.toLowerCase() === q.toLowerCase()) break
          q = next
        }
        const found = [...seen.values()]
        return `${log.join('\n')}\n\n${found.length ? found.map((p) => `[${p.id}] ${p.text}`).join('\n---\n') : 'No relevant information found.'}`
      },
    },
    {
      name: 'search_everything',
      category: 'Knowledge',
      description:
        'Search every source at once and merge the results: documents, company data and imported tables, notes, tasks, remembered facts and (when Internet tools are on) Wikipedia. Use when you do not know where something is.',
      keywords: 'search everything all sources anywhere find across everything documents data notes tasks memory where is look everywhere global federated',
      parameters: { query: { type: 'string', description: 'What to look for' } },
      run: async ({ query }) => {
        const words = new Set(tokenize(query))
        const matches = (text: string) => tokenize(text).some((w) => words.has(w))
        const sections: string[] = []
        const sources: string[] = []

        const kb = await advancedRetrieve(ctx, query, { k: 3 })
        sources.push('documents')
        if (kb.passages.length) sections.push(`Documents:\n${kb.passages.map((p) => `[${p.id}] ${short(p.text)}`).join('\n')}`)

        const data = searchAllData(query)
        sources.push('company data and tables')
        if (data.length) sections.push(`Company data and tables:\n${data.slice(0, 5).map((d) => `- ${d}`).join('\n')}`)

        const notes = noteStore.get().filter((n) => matches(n.text)).slice(0, 4)
        sources.push('notes')
        if (notes.length) sections.push(`Notes:\n${notes.map((n) => `- [${n.id}] ${n.text}`).join('\n')}`)

        const tasks = taskStore.get().filter((t) => matches(t.title)).slice(0, 4)
        sources.push('tasks')
        if (tasks.length) sections.push(`Tasks:\n${tasks.map((t) => `- [${t.id}] ${t.done ? '(done) ' : ''}${t.title}${t.due ? ` (due ${t.due})` : ''}`).join('\n')}`)

        const mem = memoryStore.get().filter((m) => matches(`${m.key} ${m.value}`)).slice(0, 4)
        sources.push('memory')
        if (mem.length) sections.push(`Remembered:\n${mem.map((m) => `- ${m.key}: ${m.value}`).join('\n')}`)

        if (runtime.network) {
          sources.push('Wikipedia')
          const w = await wikipedia(query)
          if (w) sections.push(`Web (Wikipedia):\n${w}`)
        }
        return `Searched: ${sources.join(', ')}.\n\n${sections.length ? sections.join('\n\n') : 'Nothing found in any source.'}`
      },
    },
    {
      name: 'explore_graph',
      category: 'Knowledge',
      description: 'Show what the knowledge graph knows about a topic or entity (a product, system, policy or term): where it is mentioned and what it is related to. Good for "how does X relate to Y" questions.',
      keywords: 'graph relationships related connected relate how does relate entity links connections knowledge graph what is connected to associated with mentioned together',
      parameters: { entity: { type: 'string', description: 'The topic or entity, e.g. "ERP" or "Odoo"' } },
      run: ({ entity }) => {
        const stats = graphStats(ctx.index)
        return `${describeEntity(ctx.index, entity)}\n(Graph: ${stats.entities} entities, ${Math.round(stats.links)} links)`
      },
    },
  ]
}

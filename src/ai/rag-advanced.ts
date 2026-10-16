import { tryGenerate } from './generate'
import { retrieve, retrieveHybrid, tokenize } from './rag'
import type { Chunk, Hit, Index } from './rag'
import type { ToolContext } from './tool-types'
import { getJson } from './tools/web'

/**
 * Advanced retrieval built on top of the keyword + semantic search in rag.ts:
 *  - Graph RAG: an entity graph (who/what is mentioned together) finds related passages
 *  - Multi-representation: each document also has a short "summary view" (title, headings, first sentences)
 *  - Reranking, parent-child expansion (neighbouring chunks), reciprocal rank fusion
 *  - Accurate mode: query rewriting, HyDE, grading (Self-RAG / CRAG), corrective retry and a web fallback
 */

type Ctx = Pick<ToolContext, 'index' | 'semantic'>

export interface Passage {
  /** Id of the best-matching chunk (used for citations). */
  id: string
  title: string
  text: string
}

export interface Retrieval {
  hits: Hit[]
  passages: Passage[]
  /** What the pipeline did, in order (shown to the user so the process is visible). */
  steps: string[]
  /** Text from the web when the documents had nothing relevant (corrective RAG). */
  web?: string
}

// ---------- Reciprocal rank fusion ----------

function fuse(lists: { hits: Hit[]; weight?: number }[]): Hit[] {
  const score = new Map<string, number>()
  const chunk = new Map<string, Chunk>()
  for (const { hits, weight = 1 } of lists) {
    hits.forEach((h, i) => {
      score.set(h.chunk.id, (score.get(h.chunk.id) ?? 0) + weight / (60 + i))
      chunk.set(h.chunk.id, h.chunk)
    })
  }
  const top = Math.max(...score.values(), 0)
  return [...score]
    .sort((a, b) => b[1] - a[1])
    .map(([id, s]) => ({ chunk: chunk.get(id)!, score: top ? s / top : 0 }))
}

// ---------- Multi-representation: a summary view of each document ----------

const docViews = new WeakMap<Index, Map<string, { title: string; words: Set<string> }>>()

function docView(index: Index) {
  let views = docViews.get(index)
  if (views) return views
  views = new Map()
  for (const c of index.chunks) {
    const first = c.text.replace(/^#+\s.*$/gm, '').trim().match(/[^.!?\n]+[.!?]?/)?.[0] ?? ''
    const v = views.get(c.docId) ?? { title: c.title, words: new Set<string>() }
    for (const w of tokenize(`${c.title} ${c.heading} ${first}`)) v.words.add(w)
    views.set(c.docId, v)
  }
  docViews.set(index, views)
  return views
}

/** How well each document's summary view matches the query (0 to 1). */
function docScores(index: Index, query: string): Map<string, number> {
  const words = [...new Set(tokenize(query))]
  const out = new Map<string, number>()
  const weight = (w: string) => index.idf.get(w) ?? Math.log(1 + index.chunks.length)
  const total = words.reduce((a, w) => a + weight(w), 0)
  if (!total) return out
  for (const [id, v] of docView(index)) {
    out.set(id, words.filter((w) => v.words.has(w)).reduce((a, w) => a + weight(w), 0) / total)
  }
  return out
}

// ---------- Graph RAG ----------

interface Entity {
  name: string
  chunks: Set<string>
  links: Map<string, number>
}

const graphs = new WeakMap<Index, Map<string, Entity>>()

const LEADING_STOP = /^(the|a|an|this|that|these|those|if|when|in|on|for|all|each|your|our|we|you|it|is|are|to|and|or|but|see|note|step|how|what|why)\s+/i

/** Names of things mentioned in a piece of text: acronyms, capitalised phrases, headings and `code` terms. */
function entitiesIn(text: string): string[] {
  const found = new Set<string>()
  for (const m of text.matchAll(/^#{1,6}\s+(.+)$/gm)) found.add(m[1].trim().toLowerCase())
  for (const m of text.matchAll(/`([^`\n]{2,40})`/g)) found.add(m[1].trim().toLowerCase())
  for (const m of text.matchAll(/\b[A-Z][A-Za-z0-9&]*(?:\s+[A-Z][A-Za-z0-9&]*){0,3}\b/g)) {
    let phrase = m[0]
    while (LEADING_STOP.test(phrase)) phrase = phrase.replace(LEADING_STOP, '')
    if (!phrase) continue
    const single = !phrase.includes(' ')
    const before = text.slice(Math.max(0, (m.index ?? 0) - 2), m.index ?? 0)
    const sentenceStart = (m.index ?? 0) === 0 || /[.!?:\n#*-]\s*$/.test(before) || /\n\s*$/.test(before)
    const acronym = /^[A-Z][A-Z0-9&]{1,}$/.test(phrase)
    if (single && !acronym && (sentenceStart || phrase.length < 4)) continue
    found.add(phrase.toLowerCase())
  }
  return [...found].filter((e) => e.length >= 2 && e.length <= 60).slice(0, 14)
}

function getGraph(index: Index): Map<string, Entity> {
  let g = graphs.get(index)
  if (g) return g
  g = new Map()
  for (const c of index.chunks) {
    const names = entitiesIn(`${c.heading ? `# ${c.heading}\n` : ''}${c.text}`)
    for (const n of names) {
      const e = g.get(n) ?? { name: n, chunks: new Set<string>(), links: new Map<string, number>() }
      e.chunks.add(c.id)
      g.set(n, e)
    }
    for (const a of names) for (const b of names) if (a !== b) g.get(a)!.links.set(b, (g.get(a)!.links.get(b) ?? 0) + 1)
  }
  graphs.set(index, g)
  return g
}

/** Entities from the graph that the query mentions. */
function linkEntities(g: Map<string, Entity>, query: string): Entity[] {
  const q = ` ${query.toLowerCase().replace(/[^a-z0-9&`# ]+/g, ' ')} `
  const qTokens = new Set(tokenize(query))
  const linked: Entity[] = []
  for (const e of g.values()) {
    const plain = e.name.replace(/[^a-z0-9& ]+/g, ' ').trim()
    if (!plain) continue
    if (q.includes(` ${plain} `)) linked.push(e)
    else {
      const toks = tokenize(plain)
      if (toks.length > 1 && toks.every((t) => qTokens.has(t))) linked.push(e)
    }
  }
  // Prefer specific (long, rare) entities over generic ones.
  return linked.sort((a, b) => b.name.length - a.name.length || a.chunks.size - b.chunks.size).slice(0, 5)
}

/** Passages connected to the entities in the query, directly or through one related entity. */
export function graphSearch(index: Index, query: string, k = 8): Hit[] {
  const g = getGraph(index)
  const seeds = linkEntities(g, query)
  if (!seeds.length) return []
  const score = new Map<string, number>()
  for (const e of seeds) {
    const w = 1 / Math.log(2 + e.chunks.size)
    for (const id of e.chunks) score.set(id, (score.get(id) ?? 0) + w)
    const near = [...e.links].sort((a, b) => b[1] - a[1]).slice(0, 4)
    for (const [name, strength] of near) {
      const n = g.get(name)
      if (!n) continue
      for (const id of n.chunks) score.set(id, (score.get(id) ?? 0) + 0.3 * w * Math.min(1, strength / 2))
    }
  }
  const byId = new Map(index.chunks.map((c) => [c.id, c]))
  const top = Math.max(...score.values(), 0)
  return [...score]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id, s]) => ({ chunk: byId.get(id)!, score: top ? s / top : 0 }))
}

/** What the knowledge graph knows about an entity: where it appears and what it appears with. */
export function describeEntity(index: Index, name: string): string {
  const g = getGraph(index)
  const q = name.trim().toLowerCase()
  const e = g.get(q) ?? [...g.values()].filter((x) => x.name.includes(q)).sort((a, b) => b.chunks.size - a.chunks.size)[0]
  if (!e) {
    const names = [...g.values()].sort((a, b) => b.chunks.size - a.chunks.size).slice(0, 15).map((x) => x.name)
    return `No entity matches "${name}". Common entities: ${names.join(', ')}.`
  }
  const related = [...e.links].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, w]) => `${n} (${w})`)
  return `${e.name}\nAppears in: ${[...e.chunks].slice(0, 8).join(', ')}${e.chunks.size > 8 ? ` and ${e.chunks.size - 8} more` : ''}\nRelated to: ${related.join(', ') || 'nothing else'}`
}

/** Terms that often appear alongside the entities in a text: good follow-up searches when no model can suggest one. */
export function relatedTerms(index: Index, text: string, limit = 3): string[] {
  const g = getGraph(index)
  const mentioned = linkEntities(g, text)
  const known = new Set(mentioned.map((e) => e.name))
  const score = new Map<string, number>()
  for (const e of mentioned) for (const [n, w] of e.links) if (!known.has(n) && !text.toLowerCase().includes(n)) score.set(n, (score.get(n) ?? 0) + w)
  return [...score].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([n]) => n)
}

export const wikipedia = wikipediaSummary

export const graphStats = (index: Index) => {
  const g = getGraph(index)
  return { entities: g.size, links: [...g.values()].reduce((a, e) => a + e.links.size, 0) / 2 }
}

// ---------- Reranking ----------

/** Re-score candidates by phrase and word-pair overlap with the question, title and heading matches, and coverage. */
export function rerank(query: string, hits: Hit[]): Hit[] {
  const q = tokenize(query)
  const qSet = new Set(q)
  const pairs = new Set(q.slice(1).map((w, i) => `${q[i]} ${w}`))
  const phrase = query.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const best = Math.max(...hits.map((h) => h.score), 0)
  return hits
    .map((h) => {
      const toks = tokenize(`${h.chunk.title} ${h.chunk.heading} ${h.chunk.text}`)
      const have = new Set(toks)
      const pairHits = toks.slice(1).filter((w, i) => pairs.has(`${toks[i]} ${w}`)).length
      const pairFrac = pairs.size ? Math.min(1, pairHits / pairs.size) : 0
      const cover = qSet.size ? [...qSet].filter((w) => have.has(w)).length / qSet.size : 0
      const head = tokenize(`${h.chunk.title} ${h.chunk.heading}`)
      const headMatch = qSet.size ? head.filter((w) => qSet.has(w)).length / Math.max(1, Math.min(head.length, qSet.size)) : 0
      const exact = phrase.length > 8 && h.chunk.text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').includes(phrase) ? 1 : 0
      const score = 0.4 * (best ? h.score / best : 0) + 0.2 * pairFrac + 0.2 * cover + 0.1 * Math.min(1, headMatch) + 0.1 * exact
      return { chunk: h.chunk, score }
    })
    .sort((a, b) => b.score - a.score)
}

// ---------- Parent-child expansion ----------

/** Small chunks are searched; the text around them (previous and next chunk of the same document) is returned. */
export function expandParents(index: Index, hits: Hit[], radius = 1): Passage[] {
  const byDoc = new Map<string, Chunk[]>()
  for (const c of index.chunks) byDoc.set(c.docId, [...(byDoc.get(c.docId) ?? []), c])
  const used = new Set<string>()
  const out: Passage[] = []
  for (const h of hits) {
    if (used.has(h.chunk.id)) continue
    const siblings = byDoc.get(h.chunk.docId) ?? [h.chunk]
    const parts = siblings.filter((c) => Math.abs(c.pos - h.chunk.pos) <= radius && !used.has(c.id))
    for (const c of parts) used.add(c.id)
    out.push({ id: h.chunk.id, title: h.chunk.title, text: parts.map((c) => c.text).join('\n\n') })
  }
  return out
}

// ---------- LLM steps (skipped when no model is available) ----------

async function rewriteQuery(query: string): Promise<string[]> {
  const out = await tryGenerate(
    `Rewrite this search question as 3 different short keyword queries that could find the answer in company documents. Use synonyms and related terms. One query per line, no numbering, no explanations.\n\nQuestion: ${query}`,
    { maxTokens: 80 },
  )
  return (out ?? '')
    .split('\n')
    .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((l) => l.length > 2 && l.toLowerCase() !== query.toLowerCase())
    .slice(0, 3)
}

/** HyDE: write the kind of passage that would answer the question, then search with that text. */
async function hypotheticalAnswer(query: string): Promise<string | null> {
  return tryGenerate(`Write a short passage (2 to 3 sentences) from a company handbook that answers this question. Plain text only.\n\nQuestion: ${query}`, { maxTokens: 120 })
}

/** Self-RAG / corrective RAG: ask the model which passages actually help answer the question. */
async function gradeHits(query: string, hits: Hit[]): Promise<Hit[] | null> {
  if (!hits.length) return []
  const shown = hits.slice(0, 6)
  const out = await tryGenerate(
    `Question: ${query}\n\nPassages:\n${shown.map((h, i) => `[${i + 1}] ${h.chunk.text.replace(/\s+/g, ' ').slice(0, 350)}`).join('\n')}\n\nWhich passages contain information that helps answer the question? Reply as JSON: {"relevant":[numbers]}. Use an empty list if none help.`,
    { json: true, maxTokens: 40 },
  )
  if (!out) return null
  try {
    const nums = (JSON.parse(out) as { relevant?: unknown }).relevant
    if (!Array.isArray(nums)) return null
    return shown.filter((_, i) => nums.includes(i + 1))
  } catch {
    return null
  }
}

async function wikipediaSummary(topic: string): Promise<string | null> {
  try {
    const found = await getJson<[string, string[]]>(
      `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(topic)}&limit=1&format=json&origin=*`,
    )
    const title = found[1][0]
    if (!title) return null
    const s = await getJson<{ title: string; extract: string; content_urls?: { desktop?: { page?: string } } }>(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    )
    return `${s.title}: ${s.extract.slice(0, 700)} (Source: ${s.content_urls?.desktop?.page ?? 'https://wikipedia.org'})`
  } catch {
    return null
  }
}

// ---------- The pipeline ----------

interface Options {
  k?: number
  /** Add query rewriting, HyDE, grading and a corrective retry (slower: several model calls). */
  accurate?: boolean
  /** Allow a Wikipedia fallback when nothing relevant is found (accurate mode only). */
  web?: boolean
  document?: string
}

/** Candidates from every retrieval channel for one query: keyword + semantic, and the entity graph. */
async function candidates(ctx: Ctx, query: string, document?: string): Promise<{ text: Hit[]; graph: Hit[] }> {
  const text = await retrieveHybrid(ctx.index, query, { semantic: ctx.semantic, k: 12, minScore: 0.05, document })
  const doc = document?.trim().toLowerCase()
  const graph = graphSearch(ctx.index, query, 8).filter((h) => !doc || h.chunk.docId.toLowerCase().includes(doc) || h.chunk.title.toLowerCase().includes(doc))
  return { text, graph }
}

export async function advancedRetrieve(ctx: Ctx, query: string, opts: Options = {}): Promise<Retrieval> {
  const { k = 4, accurate = false, web = false, document } = opts
  const steps: string[] = []
  const queries = [query]

  if (accurate) {
    const variants = await rewriteQuery(query)
    if (variants.length) {
      queries.push(...variants)
      steps.push(`Rewrote the question into ${variants.length} search queries`)
    }
    const hyde = await hypotheticalAnswer(query)
    if (hyde) {
      queries.push(hyde.slice(0, 300))
      steps.push('Wrote a hypothetical answer and searched with it (HyDE)')
    }
  }

  const textLists: Hit[][] = []
  const graphLists: Hit[][] = []
  for (const q of queries) {
    const c = await candidates(ctx, q, document)
    if (c.text.length) textLists.push(c.text)
    if (c.graph.length) graphLists.push(c.graph)
  }
  steps.push(`Searched ${queries.length} ${queries.length > 1 ? 'queries' : 'query'}: ${textLists.reduce((a, l) => a + l.length, 0)} text matches, ${graphLists.reduce((a, l) => a + l.length, 0)} graph matches`)

  // Boost passages from documents whose summary view fits the question (multi-representation).
  const ds = docScores(ctx.index, query)
  const fused = fuse([...textLists.map((hits) => ({ hits })), ...graphLists.map((hits) => ({ hits, weight: 0.7 }))]).map((h) => ({
    chunk: h.chunk,
    score: h.score + 0.15 * (ds.get(h.chunk.docId) ?? 0),
  }))
  const reranked = rerank(query, fused.sort((a, b) => b.score - a.score).slice(0, 10))
  // Drop stragglers that the reranker scores far below the best passage.
  const floor = Math.max(0.15, (reranked[0]?.score ?? 0) * 0.5)
  let ranked = reranked.filter((h) => h.score >= floor).slice(0, accurate ? 6 : k)
  steps.push(`Reranked ${Math.min(10, fused.length)} candidates`)

  if (accurate) {
    let graded = await gradeHits(query, ranked)
    if (graded === null) steps.push('Skipped grading (no AI model)')
    else {
      steps.push(`Graded ${Math.min(6, ranked.length)} passages: ${graded.length} relevant`)
      if (!graded.length) {
        // Corrective step: widen the keyword search and look again before giving up.
        steps.push('Nothing relevant: retrying with a broader search')
        const wide = fuse([{ hits: retrieve(ctx.index, query, 8, 0.02) }, { hits: graphSearch(ctx.index, query, 6), weight: 0.7 }])
        graded = (await gradeHits(query, rerank(query, wide).slice(0, 6))) ?? []
        steps.push(`Second pass: ${graded.length} relevant`)
      }
      if (!graded.length) {
        if (web) {
          const text = await wikipediaSummary(query)
          steps.push(text ? 'Fell back to Wikipedia' : 'Wikipedia had nothing either')
          return { hits: [], passages: [], steps, web: text ?? undefined }
        }
        steps.push('No web fallback (Internet tools are off)')
        return { hits: [], passages: [], steps }
      }
      ranked = graded
    }
    ranked = ranked.slice(0, k)
  }

  const passages = expandParents(ctx.index, ranked, 1)
  steps.push(`Returned ${passages.length} passage${passages.length === 1 ? '' : 's'} with surrounding context`)
  return { hits: ranked, passages, steps }
}

export const formatPassages = (r: Retrieval) => r.passages.map((p) => `[${p.id}] ${p.text}`).join('\n---\n')

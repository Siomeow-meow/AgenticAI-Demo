import type { SourceDoc } from './documents'

export interface Chunk {
  id: string
  docId: string
  title: string
  text: string
  vector: Map<string, number>
  norm: number
}

export interface Hit {
  chunk: Chunk
  score: number
}

/** Lightweight, JSON-safe description of a retrieved chunk (for the UI). */
export interface Source {
  id: string
  title: string
  score: number
}

export const toSources = (hits: Hit[]): Source[] =>
  hits.map((h) => ({ id: h.chunk.id, title: h.chunk.title, score: h.score }))

export interface Index {
  chunks: Chunk[]
  idf: Map<string, number>
}

const STOPWORDS = new Set(
  'a an and are as at be by for from how i in is it its of on or that the this to was what when where which who why with you do does can'.split(
    ' ',
  ),
)

// Very light stemmer so "chunks"/"chunk" and "retrieves"/"retrieve" match.
function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 3 && w.endsWith('es')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => !STOPWORDS.has(w))
    .map(stem)
}

/** Break one over-long paragraph into pieces of at most `maxWords` words, on sentence or word boundaries. */
function splitLong(para: string, maxWords: number): string[] {
  if (para.split(/\s+/).length <= maxWords) return [para]
  const pieces: string[] = []
  let cur: string[] = []
  for (const sentence of para.match(/[^.!?\n]+[.!?]*\s*/g) ?? [para]) {
    for (const word of sentence.trim().split(/\s+/).filter(Boolean)) {
      cur.push(word)
      if (cur.length >= maxWords) {
        pieces.push(cur.join(' '))
        cur = []
      }
    }
  }
  if (cur.length) pieces.push(cur.join(' '))
  return pieces
}

/** Split on paragraphs, packing them into chunks of up to `maxWords` words. */
export function chunkText(text: string, maxWords = 120): string[] {
  const out: string[] = []
  let cur: string[] = []
  let count = 0
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => splitLong(p, maxWords))
  for (const para of paras) {
    const n = para.split(/\s+/).length
    if (count + n > maxWords && cur.length) {
      out.push(cur.join('\n\n'))
      cur = []
      count = 0
    }
    cur.push(para)
    count += n
  }
  if (cur.length) out.push(cur.join('\n\n'))
  return out
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  return tf
}

function weigh(tf: Map<string, number>, idf: Map<string, number>) {
  const vector = new Map<string, number>()
  let sum = 0
  for (const [term, count] of tf) {
    const w = (1 + Math.log(count)) * (idf.get(term) ?? 0)
    if (w > 0) {
      vector.set(term, w)
      sum += w * w
    }
  }
  return { vector, norm: Math.sqrt(sum) }
}

export function buildIndex(docs: SourceDoc[], maxWords = 120): Index {
  const raw = docs.flatMap((d) =>
    chunkText(d.text, maxWords).map((text, i) => ({
      id: `${d.id}#${i + 1}`,
      docId: d.id,
      title: d.title,
      text,
      tf: termFreq(tokenize(`${d.title} ${text}`)),
    })),
  )

  const df = new Map<string, number>()
  for (const r of raw) for (const t of r.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
  const idf = new Map<string, number>()
  for (const [t, n] of df) idf.set(t, Math.log(1 + raw.length / n))

  const chunks = raw.map(({ tf, ...r }) => ({ ...r, ...weigh(tf, idf) }))
  return { chunks, idf }
}

export function retrieve(index: Index, query: string, k = 3, minScore = 0.05): Hit[] {
  const q = weigh(termFreq(tokenize(query)), index.idf)
  if (q.norm === 0) return []
  return index.chunks
    .map((chunk) => {
      let dot = 0
      for (const [t, w] of q.vector) dot += w * (chunk.vector.get(t) ?? 0)
      return { chunk, score: chunk.norm ? dot / (q.norm * chunk.norm) : 0 }
    })
    .filter((h) => h.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

/** Optional semantic (embedding) index that runs alongside the keyword index. */
export interface Semantic {
  vectors: Map<string, number[]>
  embedQuery: (query: string) => Promise<number[]>
}

/** Embedding similarity above which a chunk counts as relevant (tuned for nomic-embed-text). */
const SEMANTIC_MIN = 0.55

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/**
 * How much of the question the chunk covers: the share of the question's words (weighted by how rare
 * they are) that appear in the chunk. Words the documents never use count in full, so a question about
 * something the knowledge base does not know (e.g. another company's product) scores low.
 */
export function coverage(index: Index, query: string, chunk: Chunk): number {
  const words = [...new Set(tokenize(query))]
  if (!words.length) return 0
  const unknown = Math.log(1 + index.chunks.length)
  const weight = (w: string) => index.idf.get(w) ?? unknown
  const total = words.reduce((a, w) => a + weight(w), 0)
  return words.filter((w) => chunk.vector.has(w)).reduce((a, w) => a + weight(w), 0) / total
}

export interface RetrieveOptions {
  minScore?: number
  k?: number
  semantic?: Semantic | null
  /** Only search chunks of the document whose id or title contains this text. */
  document?: string
}

/**
 * Hybrid retrieval: keyword (TF-IDF) and, when available, semantic (embeddings)
 * rankings are merged with reciprocal rank fusion. Falls back to keywords alone.
 */
export async function retrieveHybrid(index: Index, query: string, opts: RetrieveOptions = {}): Promise<Hit[]> {
  const { k = 3, semantic, document } = opts
  const doc = document?.trim().toLowerCase()
  const pool: Index = doc
    ? { ...index, chunks: index.chunks.filter((c) => c.docId.toLowerCase().includes(doc) || c.title.toLowerCase().includes(doc)) }
    : index

  const lexical = retrieve(pool, query, pool.chunks.length, 0)
  const lexicalScore = new Map(lexical.map((h) => [h.chunk.id, h.score]))
  const best = lexical[0]?.score ?? 0
  // Keep only matches that are strong, close to the best one, and cover enough of what was asked.
  const floor = opts.minScore ?? 0.1
  const keywordOnly = () =>
    lexical.filter((h) => h.score >= floor && h.score >= best * 0.4 && coverage(index, query, h.chunk) >= 0.35).slice(0, k)
  if (!semantic) return keywordOnly()

  let qv: number[]
  try {
    qv = await semantic.embedQuery(query)
  } catch {
    return keywordOnly()
  }

  const sem = pool.chunks
    .map((chunk) => {
      const v = semantic.vectors.get(chunk.id)
      return { chunk, score: v ? cosine(qv, v) : 0 }
    })
    .sort((a, b) => b.score - a.score)

  const fused = new Map<string, number>()
  lexical.forEach((h, i) => {
    if (h.score > 0) fused.set(h.chunk.id, 1 / (60 + i))
  })
  sem.forEach((h, i) => fused.set(h.chunk.id, (fused.get(h.chunk.id) ?? 0) + 1 / (60 + i)))

  return sem
    .filter((h) => h.score >= SEMANTIC_MIN || (lexicalScore.get(h.chunk.id) ?? 0) >= 0.05)
    .sort((a, b) => (fused.get(b.chunk.id) ?? 0) - (fused.get(a.chunk.id) ?? 0))
    .slice(0, k)
}

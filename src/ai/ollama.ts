import { Ollama } from 'ollama/browser'
import type { Semantic } from './rag'
import type { Chunk } from './rag'

export const ollama = new Ollama({ host: 'http://127.0.0.1:11434' })

// Optional small embedding model (~270 MB) for semantic search. Install with: ollama pull nomic-embed-text
export const EMBED_MODEL: string = import.meta.env.VITE_EMBED_MODEL ?? 'nomic-embed-text'

/** Resolves true if the embedding model is available in Ollama. */
export async function checkEmbedModel(): Promise<boolean> {
  try {
    const { models } = await ollama.list()
    return models.some((m) => m.name === EMBED_MODEL || m.name.startsWith(`${EMBED_MODEL}:`))
  } catch {
    return false
  }
}

async function embed(texts: string[]): Promise<number[][]> {
  const res = await ollama.embed({ model: EMBED_MODEL, input: texts, keep_alive: '1m' })
  return res.embeddings
}

// Vectors are cached per chunk text so re-indexing after an upload only embeds new chunks.
const cache = new Map<string, number[]>()

/** Embed every chunk (in small batches, to keep memory low) and return a semantic index. */
export async function buildSemantic(chunks: Chunk[]): Promise<Semantic> {
  const key = (c: Chunk) => `${EMBED_MODEL}|${c.title}|${c.text}`
  const missing = chunks.filter((c) => !cache.has(key(c)))
  for (let i = 0; i < missing.length; i += 16) {
    const batch = missing.slice(i, i + 16)
    const vectors = await embed(batch.map((c) => `search_document: ${c.title}\n${c.text}`))
    batch.forEach((c, j) => cache.set(key(c), vectors[j]))
  }
  const vectors = new Map(chunks.map((c) => [c.id, cache.get(key(c))!] as const))
  return { vectors, embedQuery: async (q) => (await embed([`search_query: ${q}`]))[0] }
}

export interface InstalledModel {
  name: string
  sizeGB: number
  /** Supports tool calling. */
  tools: boolean
  /** "Thinks" before answering (we turn that off to keep replies fast). */
  thinking: boolean
}

/** Chat models installed in Ollama (embedding models are left out), or null if Ollama is not reachable. */
export async function listChatModels(): Promise<InstalledModel[] | null> {
  try {
    const { models } = await ollama.list()
    const detailed = await Promise.all(
      models.map(async (m) => {
        let caps: string[] = []
        try {
          caps = (await ollama.show({ model: m.name })).capabilities ?? []
        } catch {
          /* unknown capabilities: assume a plain chat model */
        }
        return { m, caps }
      }),
    )
    return detailed
      .filter(({ caps }) => !(caps.includes('embedding') && !caps.includes('completion')))
      .map(({ m, caps }) => ({
        name: m.name,
        sizeGB: m.size / 1e9,
        tools: caps.includes('tools'),
        thinking: caps.includes('thinking'),
      }))
  } catch {
    return null
  }
}

let visionCache: { at: number; model: string | null } | null = null

/** An installed model that can read images (the first one Ollama reports with the "vision" capability), or null. */
export async function findVisionModel(): Promise<string | null> {
  if (visionCache && Date.now() - visionCache.at < 30_000) return visionCache.model
  let found: string | null = null
  try {
    const { models } = await ollama.list()
    for (const m of models) {
      const caps = (await ollama.show({ model: m.name })).capabilities ?? []
      if (caps.includes('vision')) {
        found = m.name
        break
      }
    }
  } catch {
    /* Ollama is not reachable */
  }
  visionCache = { at: Date.now(), model: found }
  return found
}

/** Download a model, reporting progress as text and (when known) a percentage. */
export async function pullModel(name: string, onProgress: (status: string, percent: number | null) => void) {
  const stream = await ollama.pull({ model: name, stream: true })
  for await (const p of stream) onProgress(p.status, p.total ? Math.round((p.completed / p.total) * 100) : null)
}

/** Delete a model from disk. */
export const deleteModel = (name: string) => ollama.delete({ model: name })

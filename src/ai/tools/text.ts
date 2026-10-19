import type { Tool } from '../tool-types'

const toBase64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
const fromBase64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)))

const OPS: Record<string, (t: string) => string> = {
  uppercase: (t) => t.toUpperCase(),
  lowercase: (t) => t.toLowerCase(),
  titlecase: (t) => t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
  slug: (t) => t.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  reverse: (t) => [...t].reverse().join(''),
  base64_encode: toBase64,
  base64_decode: fromBase64,
  url_encode: encodeURIComponent,
  url_decode: decodeURIComponent,
}

export const textTools: Tool[] = [
  {
    name: 'text_stats',
    category: 'Text & data',
    description: 'Count words, characters, sentences and estimate reading time for a piece of text.',
    keywords: 'count words characters length sentences reading time statistics how long word count',
    parameters: { text: { type: 'string', description: 'The text to analyse' } },
    run: ({ text }) => {
      const words = text.trim() ? text.trim().split(/\s+/).length : 0
      const sentences = (text.match(/[.!?]+(\s|$)/g) ?? []).length || (words ? 1 : 0)
      return `${words} words, ${text.length} characters, ${sentences} sentence(s), about ${Math.max(1, Math.round(words / 200))} min read.`
    },
  },
  {
    name: 'text_transform',
    category: 'Text & data',
    description: `Transform text. Operations: ${Object.keys(OPS).join(', ')}.`,
    keywords: 'uppercase lowercase title case slug reverse base64 encode decode url encode convert text format',
    parameters: {
      text: { type: 'string', description: 'Text to transform' },
      operation: { type: 'string', description: `One of: ${Object.keys(OPS).join(', ')}` },
    },
    run: ({ text, operation = '' }) => {
      const op = OPS[operation.toLowerCase().replace(/[\s-]/g, '_')]
      if (!op) return `Unknown operation. Use one of: ${Object.keys(OPS).join(', ')}`
      try {
        return op(text)
      } catch {
        return 'Could not transform that text (invalid input for this operation).'
      }
    },
  },
  {
    name: 'hash_text',
    category: 'Text & data',
    description: 'Compute a SHA-1, SHA-256 or SHA-512 hash (hex) of some text.',
    keywords: 'hash sha sha256 checksum digest fingerprint',
    parameters: {
      text: { type: 'string', description: 'Text to hash' },
      algorithm: { type: 'string', description: 'sha-1, sha-256 (default) or sha-512', optional: true },
    },
    run: async ({ text, algorithm = 'sha-256' }) => {
      const algo = algorithm.toUpperCase().replace(/^SHA-?/, 'SHA-')
      if (!['SHA-1', 'SHA-256', 'SHA-512'].includes(algo)) return 'Use sha-1, sha-256 or sha-512.'
      const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text))
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
    },
  },
  {
    name: 'json_tool',
    category: 'Text & data',
    description: 'Validate, pretty-print or minify JSON.',
    keywords: 'json format validate pretty print minify parse syntax valid',
    parameters: {
      text: { type: 'string', description: 'The JSON text' },
      action: { type: 'string', description: 'format, validate or minify', optional: true },
    },
    run: ({ text, action = 'format' }) => {
      try {
        const data: unknown = JSON.parse(text)
        if (/valid/i.test(action)) return 'Valid JSON.'
        return JSON.stringify(data, null, /min/i.test(action) ? 0 : 2)
      } catch (e) {
        return `Invalid JSON: ${(e as Error).message}`
      }
    },
  },
]

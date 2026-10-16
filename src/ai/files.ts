import { strFromU8, unzipSync } from 'fflate'
import { readTable } from './csv'
import type { Table } from './csv'
import { addDataset, coreLabel, detectCore, importCoreTable } from './datasets'
import type { SourceDoc } from './documents'
import { parseUpload } from './ingest'

/** What the chat shows (and tells the model) about a file the user attached. */
export interface Attachment {
  name: string
  kind: 'table' | 'document' | 'image' | 'error'
  /** Dataset name, document id or uploaded image id the assistant's tools can use. */
  ref: string
  /** Images only: where the server serves the uploaded file (for the thumbnail). */
  url?: string
  /** Short human-readable description (rows and columns, or word count, or the error). */
  detail: string
}

export const ATTACH_ACCEPT = '.csv,.tsv,.json,.xlsx,.xlsm,.pdf,.docx,.pptx,.txt,.md,.html,.htm,.log,.xml,.yaml,.yml,.sql,.png,.jpg,.jpeg,.webp,.gif'

const MAX_BYTES = 25 * 1024 * 1024
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'html', 'htm', 'log', 'xml', 'yaml', 'yml', 'sql', 'ini', 'cfg', 'js', 'ts', 'py', 'java', 'c', 'cpp', 'cs', 'rtf'])
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'data'

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

function xmlText(xml: string): string {
  return xml
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Text of a Word file: the runs inside every paragraph of word/document.xml. */
function docxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' })
  const xml = files['word/document.xml']
  if (!xml) throw new Error('This does not look like a valid .docx file.')
  return strFromU8(xml)
    .split(/<\/w:p>/)
    .map((p) => xmlText([...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\/>/g)].map((m) => m[1] ?? '\t').join('')).trim())
    .filter(Boolean)
    .join('\n\n')
}

/** Text of a PowerPoint file, slide by slide. */
function pptxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) })
  const names = Object.keys(files).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]))
  if (!names.length) throw new Error('This does not look like a valid .pptx file.')
  return names
    .map((n, i) => {
      const text = strFromU8(files[n])
        .split(/<\/a:p>/)
        .map((p) => xmlText([...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('')).trim())
        .filter(Boolean)
        .join('\n')
      return `Slide ${i + 1}\n${text}`
    })
    .join('\n\n')
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise
  const pages: string[] = []
  for (let n = 1; n <= Math.min(pdf.numPages, 300); n++) {
    const content = await (await pdf.getPage(n)).getTextContent()
    let text = ''
    for (const item of content.items) {
      if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ')
    }
    pages.push(text.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim())
  }
  return pages.filter(Boolean).join('\n\n')
}

async function sheetTables(file: File, base: string): Promise<{ name: string; table: Table }[]> {
  const { default: readXlsxFile } = await import('read-excel-file/browser')
  const sheets = await readXlsxFile(file)
  const out: { name: string; table: Table }[] = []
  for (const { sheet, data } of sheets) {
    const rows = data.map((r) => r.map(cellText))
    const headerAt = rows.findIndex((r) => r.some((c) => c.trim() !== ''))
    if (headerAt < 0 || rows.length - headerAt < 2) continue
    const headers = rows[headerAt].map((h, i) => h.trim() || `column_${i + 1}`)
    const body = rows.slice(headerAt + 1).filter((r) => r.some((c) => c.trim() !== ''))
    out.push({
      name: sheets.length > 1 ? `${base}_${slug(sheet)}` : base,
      table: { headers, rows: body.map((r) => headers.map((_, i) => (r[i] ?? '').trim())) },
    })
  }
  return out
}

export interface ReadResult {
  tables: { name: string; table: Table }[]
  docs: SourceDoc[]
}

/** Read a file the user attached. Throws an Error with a readable message if it cannot be used. */
export async function readFile(file: File): Promise<ReadResult> {
  if (file.size > MAX_BYTES) throw new Error('That file is larger than 25 MB.')
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const base = slug(file.name.replace(/\.[^.]+$/, ''))

  if (ext === 'csv' || ext === 'tsv' || ext === 'json') {
    const text = await file.text()
    try {
      return { tables: [{ name: base, table: readTable(file.name, text) }], docs: [] }
    } catch (e) {
      if (ext !== 'json') throw e
      return { tables: [], docs: [parseUpload(file.name, text)] } // JSON that is not a list of records: keep as text
    }
  }
  if (ext === 'xlsx' || ext === 'xlsm') {
    const tables = await sheetTables(file, base)
    if (!tables.length) throw new Error('No sheet with a header row and data was found.')
    return { tables, docs: [] }
  }
  if (ext === 'pdf') {
    const text = await pdfText(new Uint8Array(await file.arrayBuffer()))
    if (!text.trim()) throw new Error('No text found. This PDF may be a scan (images), which needs OCR.')
    return { tables: [], docs: [{ id: file.name.replace(/\.[^.]+$/, ''), title: file.name.replace(/\.[^.]+$/, ''), text }] }
  }
  if (ext === 'docx' || ext === 'pptx') {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const text = ext === 'docx' ? docxText(bytes) : pptxText(bytes)
    if (!text.trim()) throw new Error('No text found in that file.')
    return { tables: [], docs: [{ id: file.name.replace(/\.[^.]+$/, ''), title: file.name.replace(/\.[^.]+$/, ''), text }] }
  }
  if (TEXT_EXT.has(ext) || file.type.startsWith('text/')) {
    return { tables: [], docs: [parseUpload(file.name, await file.text())] }
  }
  throw new Error(`.${ext || 'unknown'} files are not supported. Try CSV, Excel, PDF, Word, PowerPoint, JSON or text.`)
}

const MAX_INDEXED_ROWS = 3000

/** A table turned into text, one paragraph per row, so the knowledge search can find individual rows. */
function tableDoc(name: string, table: Table): SourceDoc {
  const body = table.rows.slice(0, MAX_INDEXED_ROWS).map((r) => table.headers.map((h, i) => `${h}: ${r[i] ?? ''}`).join(', '))
  return { id: `table-${name}`, title: `${name} (table rows)`, text: body.join('\n\n') }
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/**
 * Read files, store their contents where the tools can find them (tables as datasets,
 * text as knowledge documents) and describe each one for the chat.
 * `saveDocs` adds documents to the knowledge base.
 */
export async function ingestFiles(
  files: File[],
  saveDocs: (docs: SourceDoc[]) => void,
  uploadImage?: (file: File) => Promise<{ image_id: string; url: string }>,
): Promise<Attachment[]> {
  const out: Attachment[] = []
  for (const file of files) {
    try {
      // Images go to the local server, where the hosted vision model can read them.
      if (file.type.startsWith('image/')) {
        if (!uploadImage) throw new Error('Images need the Hosted model: the local Ollama models read text only.')
        const { image_id, url } = await uploadImage(file)
        out.push({ name: file.name, kind: 'image', ref: image_id, url, detail: 'image for the hosted vision model' })
        continue
      }
      const { tables, docs } = await readFile(file)
      const tableDocs: SourceDoc[] = []
      for (const t of tables) {
        addDataset(t.name, t.table) // exact analysis: totals, filters, grouping
        tableDocs.push(tableDoc(t.name, t.table)) // search: find rows and facts like any other document
        let replaced = ''
        const kind = detectCore(t.table)
        if (kind) {
          try {
            importCoreTable(kind, t.table)
            replaced = `; now used for ${coreLabel(kind).toLowerCase()} lookups instead of the sample records`
          } catch {
            /* columns did not fit that record type: keep it as a plain table */
          }
        }
        out.push({
          name: file.name,
          kind: 'table',
          ref: t.name,
          detail: `${t.table.rows.length} rows; columns: ${t.table.headers.slice(0, 12).join(', ')}${t.table.headers.length > 12 ? ', ...' : ''}${t.table.rows.length > MAX_INDEXED_ROWS ? `; first ${MAX_INDEXED_ROWS} rows searchable` : ''}${replaced}`,
        })
      }
      if (docs.length || tableDocs.length) saveDocs([...docs, ...tableDocs])
      for (const d of docs) out.push({ name: file.name, kind: 'document', ref: d.id, detail: `${wordCount(d.text).toLocaleString('en-US')} words` })
    } catch (e) {
      out.push({ name: file.name, kind: 'error', ref: '', detail: (e as Error).message })
    }
  }
  return out
}

/** The note appended to a message so the model knows what was attached. */
export function describeAttachments(list: Attachment[]): string {
  const ok = list.filter((a) => a.kind !== 'error')
  if (!ok.length) return ''
  const label = (a: Attachment) =>
    a.kind === 'table' ? `table "${a.ref}" (${a.detail})` : a.kind === 'image' ? `image "${a.ref}" (${a.name})` : `document "${a.ref}" (${a.detail})`
  return `\n\n[Attached files: ${ok.map(label).join('; ')}]`
}

import { datasetStore } from '../data'
import type { Tool } from '../tool-types'

const TYPES: Record<string, string> = {
  csv: 'text/csv',
  json: 'application/json',
  md: 'text/markdown',
  txt: 'text/plain',
  html: 'text/html',
  xml: 'application/xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  sql: 'text/plain',
  ics: 'text/calendar',
}

const safeName = (n: string) => n.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/^\.+/, '').slice(0, 80)

/** Hand a text file to the browser's download. */
function download(name: string, content: string): void {
  const ext = name.split('.').pop()?.toLowerCase() ?? 'txt'
  const url = URL.createObjectURL(new Blob([content], { type: `${TYPES[ext] ?? 'text/plain'};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export const fileOutTools: Tool[] = [
  {
    name: 'write_file',
    category: 'Files',
    confirm: true,
    describe: ({ filename }) => `Create the file "${filename}" and download it to your computer`,
    description: 'Create a text file (CSV, JSON, Markdown, text, HTML, ...) with the given content and download it to the user\'s computer.',
    keywords: 'write file create save download export generate document csv json markdown txt report output make a file save as',
    parameters: {
      filename: { type: 'string', description: 'File name with extension, e.g. report.md or data.csv' },
      content: { type: 'string', description: 'The full text content of the file' },
    },
    run: ({ filename, content }) => {
      const name = safeName(filename)
      if (!/\.[a-z0-9]{1,5}$/i.test(name)) return 'Give the file name with an extension, e.g. report.md.'
      if (content.length > 2_000_000) return 'The content is too large (limit about 2 MB).'
      download(name, content)
      return `Created ${name} (${content.length.toLocaleString('en-US')} characters). Your browser is downloading it.`
    },
  },
  {
    name: 'export_dataset',
    category: 'Files',
    confirm: true,
    describe: ({ name, format = 'csv' }) => `Export the table "${name}" as ${format} and download it`,
    description: 'Download one of the imported tables as a CSV or JSON file.',
    keywords: 'export dataset table download csv json save data spreadsheet extract imported table to file',
    parameters: {
      name: { type: 'string', description: 'Table name (see list_datasets)' },
      format: { type: 'string', description: 'csv (default) or json', optional: true },
    },
    run: ({ name, format = 'csv' }) => {
      const sets = datasetStore.get()
      const q = name.trim().toLowerCase()
      const d = sets.find((s) => s.name.toLowerCase() === q) ?? sets.find((s) => s.name.toLowerCase().includes(q))
      if (!d) return `No table named "${name}". Available: ${sets.map((s) => s.name).join(', ') || 'none imported yet'}.`
      const json = /json/i.test(format)
      const body = json
        ? JSON.stringify(d.rows.map((r) => Object.fromEntries(d.headers.map((h, i) => [h, r[i] ?? '']))), null, 2)
        : [d.headers, ...d.rows].map((r) => r.map(csvCell).join(',')).join('\n')
      const file = `${safeName(d.name)}.${json ? 'json' : 'csv'}`
      download(file, body)
      return `Exported ${d.rows.length} rows to ${file}. Your browser is downloading it.`
    },
  },
]

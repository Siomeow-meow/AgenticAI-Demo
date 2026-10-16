import { Fragment, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * A small, safe Markdown renderer for the assistant's replies: headings, bold, italic, strike-through, inline code,
 * fenced code blocks (with colours and a copy button), lists, tables, quotes, rules, links and [document#n] citations.
 * It builds React elements (never raw HTML) and only allows web, mail, phone and text-message links.
 */

// ---------- Inline ----------

const SAFE_LINK = /^(https?:|mailto:|sms:|tel:)/i

interface Rule {
  re: RegExp
  render: (m: RegExpExecArray, key: string) => ReactNode
}

const RULES: Rule[] = [
  { re: /`([^`\n]+)`/, render: (m, key) => <code key={key}>{m[1]}</code> },
  { re: /\[([a-z0-9][\w-]*#\d+)\]/i, render: (m, key) => <span key={key} className="cite">{m[1]}</span> },
  {
    re: /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/,
    render: (m, key) =>
      SAFE_LINK.test(m[2]) ? (
        <a key={key} href={m[2]} target="_blank" rel="noopener noreferrer">
          {inline(m[1], key)}
        </a>
      ) : (
        <Fragment key={key}>{m[1]}</Fragment>
      ),
  },
  { re: /\*\*(?=\S)(.+?)(?<=\S)\*\*|__(?=\S)(.+?)(?<=\S)__/, render: (m, key) => <strong key={key}>{inline(m[1] ?? m[2], key)}</strong> },
  { re: /~~(?=\S)(.+?)(?<=\S)~~/, render: (m, key) => <del key={key}>{inline(m[1], key)}</del> },
  {
    re: /\*(?=[^\s*])(.+?)(?<=[^\s*])\*|(?<![A-Za-z0-9_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![A-Za-z0-9_])/,
    render: (m, key) => <em key={key}>{inline(m[1] ?? m[2], key)}</em>,
  },
  {
    re: /(?:https?:\/\/|mailto:|sms:)[^\s<>"']*[^\s<>"'.,;:!?)\]]/i,
    render: (m, key) => (
      <a key={key} href={m[0]} target="_blank" rel="noopener noreferrer">
        {m[0].length > 70 ? `${m[0].slice(0, 67)}...` : m[0]}
      </a>
    ),
  },
]

/** Turn a run of text into inline elements, finding the earliest formatting each time. */
function inline(text: string, keyBase = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let n = 0
  while (rest) {
    let best: { rule: Rule; m: RegExpExecArray } | null = null
    for (const rule of RULES) {
      const m = rule.re.exec(rest)
      if (m && (!best || m.index < best.m.index)) best = { rule, m }
    }
    if (!best) {
      out.push(unescape(rest))
      break
    }
    if (best.m.index > 0) out.push(unescape(rest.slice(0, best.m.index)))
    out.push(best.rule.render(best.m, `${keyBase}-${n++}`))
    rest = rest.slice(best.m.index + best.m[0].length)
  }
  return out
}

/** Backslash escapes such as \* and \_ show the plain character. */
const unescape = (s: string) => s.replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, '$1')

// ---------- Code colours ----------

const KEYWORDS = new Set(
  (
    'abstract and as async await break case catch class const continue def default defer del delete do elif else enum except export extends ' +
    'extern false final finally fn for from func function go if implements import in instanceof interface is lambda let match module new nil none ' +
    'not null of or package pass private protected public raise readonly return select self static struct super switch then this throw throws ' +
    'true try type typeof undefined union unsafe use using var void volatile when where while with yield ' +
    'select insert update delete create table alter drop join inner outer left right on group by order having limit values set into'
  ).split(' '),
)

/** Which comment style a language uses. */
function commentStyle(lang: string): { line: string[]; block: boolean; html: boolean } {
  const l = lang.toLowerCase()
  if (/^(py|python|sh|bash|shell|zsh|yaml|yml|toml|ruby|rb|r|powershell|ps1|dockerfile|perl|conf|ini|make|makefile)$/.test(l)) return { line: ['#'], block: false, html: false }
  if (/^(sql|lua|haskell|hs)$/.test(l)) return { line: ['--'], block: true, html: false }
  if (/^(html|xml|svg|markup)$/.test(l)) return { line: [], block: false, html: true }
  if (/^(json)$/.test(l)) return { line: [], block: false, html: false }
  return { line: ['//'], block: true, html: false }
}

/** Split code into coloured pieces: comments, strings, numbers and keywords. Anything unknown is left plain. */
function highlight(code: string, lang: string): ReactNode[] {
  const c = commentStyle(lang)
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const parts: string[] = []
  if (c.html) parts.push('(?<comment><!--[\\s\\S]*?(?:-->|$))')
  if (c.block) parts.push('(?<comment2>/\\*[\\s\\S]*?(?:\\*/|$))')
  if (c.line.length) parts.push(`(?<comment3>(?:${c.line.map(esc).join('|')})[^\\n]*)`)
  parts.push('(?<string>"(?:\\\\.|[^"\\\\\\n])*"?|\'(?:\\\\.|[^\'\\\\\\n])*\'?|`(?:\\\\.|[^`\\\\])*`?)')
  parts.push('(?<number>\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)')
  parts.push('(?<word>[A-Za-z_][A-Za-z0-9_]*)')
  const re = new RegExp(parts.join('|'), 'g')
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of code.matchAll(re)) {
    const g = m.groups ?? {}
    const idx = m.index ?? 0
    if (idx > last) out.push(code.slice(last, idx))
    last = idx + m[0].length
    const cls = g.comment || g.comment2 || g.comment3 ? 'tok-comment' : g.string ? 'tok-string' : g.number ? 'tok-number' : KEYWORDS.has(m[0].toLowerCase()) ? 'tok-keyword' : ''
    out.push(cls ? <span key={n++} className={cls}>{m[0]}</span> : m[0])
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false)
  const colored = useMemo(() => highlight(code, lang), [code, lang])
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang || 'code'}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(code).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{colored}</code>
      </pre>
    </div>
  )
}

// ---------- Blocks ----------

type Block =
  | { t: 'code'; lang: string; code: string }
  | { t: 'heading'; level: number; text: string }
  | { t: 'hr' }
  | { t: 'quote'; text: string }
  | { t: 'list'; ordered: boolean; start: number; items: { text: string; children: Block[] }[] }
  | { t: 'table'; head: string[]; align: ('left' | 'center' | 'right' | undefined)[]; rows: string[][] }
  | { t: 'para'; text: string }

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const BULLET = /^(\s*)([-*+])\s+(.*)$/
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'))

function startsBlock(line: string, next: string | undefined): boolean {
  return FENCE.test(line) || HEADING.test(line) || HR.test(line) || /^\s{0,3}>/.test(line) || BULLET.test(line) || NUMBERED.test(line) || (line.includes('|') && next !== undefined && TABLE_SEP.test(next))
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1]
      const body: string[] = []
      i++
      // An unclosed fence (a reply that is still streaming) takes the rest of the text.
      while (i < lines.length && !new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[i])) body.push(lines[i++])
      i++
      blocks.push({ t: 'code', lang: fence[2], code: body.join('\n') })
      continue
    }

    const h = HEADING.exec(line)
    if (h) {
      blocks.push({ t: 'heading', level: h[1].length, text: h[2] })
      i++
      continue
    }

    if (HR.test(line)) {
      blocks.push({ t: 'hr' })
      i++
      continue
    }

    if (/^\s{0,3}>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ''))
      blocks.push({ t: 'quote', text: body.join('\n') })
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = cells(line)
      const align = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : undefined))
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]))
      blocks.push({ t: 'table', head, align, rows })
      continue
    }

    const bullet = BULLET.exec(line)
    const numbered = NUMBERED.exec(line)
    if (bullet || numbered) {
      const ordered = !bullet
      const baseIndent = (bullet ?? numbered)![1].length
      const start = numbered ? Number(numbered[2]) : 1
      const items: { text: string; sub: string[] }[] = []
      while (i < lines.length) {
        const l = lines[i]
        const b = BULLET.exec(l)
        const n = NUMBERED.exec(l)
        const m = b ?? n
        if (m && m[1].length <= baseIndent + 1 && (ordered ? !!n : !!b)) {
          items.push({ text: m[3], sub: [] })
          i++
        } else if (items.length && (m ? m[1].length > baseIndent + 1 : /^\s+\S/.test(l))) {
          items[items.length - 1].sub.push(l) // nested list or wrapped text
          i++
        } else if (!l.trim() && i + 1 < lines.length && (BULLET.test(lines[i + 1]) || NUMBERED.test(lines[i + 1])) && items.length) {
          i++ // a blank line between items keeps the same list
        } else break
      }
      blocks.push({
        t: 'list',
        ordered,
        start,
        items: items.map((it) => {
          const indent = Math.min(...it.sub.filter((s) => s.trim()).map((s) => /^\s*/.exec(s)![0].length), 99)
          const inner = it.sub.map((s) => s.slice(Math.min(indent, /^\s*/.exec(s)![0].length))).join('\n')
          return { text: it.text, children: inner.trim() ? parseBlocks(inner) : [] }
        }),
      })
      continue
    }

    // Paragraph: runs until a blank line or the start of another block.
    const para: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) para.push(lines[i++])
    blocks.push({ t: 'para', text: para.join('\n') })
  }
  return blocks
}

/** Single line breaks inside a paragraph stay line breaks, as people expect in chat. */
function withBreaks(text: string, key: string): ReactNode[] {
  return text.split('\n').flatMap((ln, i) => (i === 0 ? inline(ln, `${key}-${i}`) : [<br key={`${key}-br${i}`} />, ...inline(ln, `${key}-${i}`)]))
}

function renderBlock(b: Block, key: string): ReactNode {
  switch (b.t) {
    case 'code':
      return <CodeBlock key={key} code={b.code} lang={b.lang} />
    case 'heading': {
      const Tag = `h${Math.min(6, b.level + 1)}` as 'h2'
      return <Tag key={key}>{inline(b.text, key)}</Tag>
    }
    case 'hr':
      return <hr key={key} />
    case 'quote':
      return <blockquote key={key}>{parseBlocks(b.text).map((c, i) => renderBlock(c, `${key}-${i}`))}</blockquote>
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul'
      return (
        <Tag key={key} {...(b.ordered && b.start !== 1 ? { start: b.start } : {})}>
          {b.items.map((it, i) => (
            <li key={i}>
              {withBreaks(it.text, `${key}-${i}`)}
              {it.children.map((c, j) => renderBlock(c, `${key}-${i}-${j}`))}
            </li>
          ))}
        </Tag>
      )
    }
    case 'table':
      return (
        <div key={key} className="md-table">
          <table>
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} style={{ textAlign: b.align[i] }}>
                    {inline(c, `${key}-h${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>
                  {b.head.map((_, ci) => (
                    <td key={ci} style={{ textAlign: b.align[ci] }}>
                      {inline(r[ci] ?? '', `${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    default:
      return <p key={key}>{withBreaks(b.text, key)}</p>
  }
}

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text])
  return <>{blocks.map((b, i) => renderBlock(b, `b${i}`))}</>
}

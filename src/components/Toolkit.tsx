import { useMemo, useState } from 'react'
import { TOOL_EXAMPLES } from '../ai/tool-examples'
import type { Tool } from '../ai/tools'

interface Props {
  tools: Tool[]
  internet: boolean
  onInternet: (on: boolean) => void
  onTry: (prompt: string) => void
}

const CATEGORY_ORDER = [
  'Company data',
  'Your data',
  'ERP',
  'HR & payroll',
  'POS',
  'Business',
  'Finance',
  'IT',
  'Networking',
  'Math & utility',
  'Statistics & math',
  'Date & time',
  'Text & data',
  'Everyday life',
  'Education & decisions',
  'Knowledge',
  'Personal workspace',
  'Internet',
]

/** Every category that has tools: the known ones in this order, then any new ones alphabetically (never hidden). */
function orderedCategories(present: Iterable<string>): string[] {
  const set = new Set(present)
  return [...CATEGORY_ORDER.filter((c) => set.has(c)), ...[...set].filter((c) => !CATEGORY_ORDER.includes(c)).sort()]
}

export function Toolkit({ tools, internet, onInternet, onTry }: Props) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tools) m.set(t.category, (m.get(t.category) ?? 0) + 1)
    return orderedCategories(m.keys()).map((c) => [c, m.get(c)!] as const)
  }, [tools])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (t: Tool) =>
      (!category || t.category === category) &&
      (!q || `${t.name} ${t.description} ${t.keywords} ${t.category}`.toLowerCase().includes(q))
    return counts
      .map(([c]) => [c, tools.filter((t) => t.category === c && match(t))] as const)
      .filter(([, list]) => list.length > 0)
  }, [tools, counts, query, category])

  const shown = groups.reduce((a, [, l]) => a + l.length, 0)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Toolkit</h1>
          <p>
            {tools.length} tools in {counts.length} categories. For each question the assistant is offered only the few most relevant
            tools, so this list can keep growing without slowing it down.
          </p>
        </div>
        <label className="switch">
          <input type="checkbox" checked={internet} onChange={(e) => onInternet(e.target.checked)} />
          <span>Internet tools</span>
        </label>
      </div>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search tools: subnet, VAT, loan, cron, inventory…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="tabs wrap">
          <button type="button" className={category === null ? 'on' : ''} onClick={() => setCategory(null)}>
            All {tools.length}
          </button>
          {counts.map(([c, n]) => (
            <button key={c} type="button" className={category === c ? 'on' : ''} onClick={() => setCategory(category === c ? null : c)}>
              {c} {n}
            </button>
          ))}
        </div>
      </div>

      {shown === 0 && <p className="empty">No tools match "{query}".</p>}

      {groups.map(([name, list]) => (
        <section key={name} className="group">
          <h2>
            {name} <span className="count">{list.length}</span>
          </h2>
          <div className="card-grid">
            {list.map((t) => {
              const example = TOOL_EXAMPLES[t.name]
              const off = t.network && !internet
              return (
                <article key={t.name} className={`card${off ? ' dim' : ''}`}>
                  <header>
                    <code>{t.name}</code>
                    {t.network && <span className="tag net">internet</span>}
                  </header>
                  <p>{t.description}</p>
                  {Object.keys(t.parameters).length > 0 && (
                    <div className="params">
                      {Object.entries(t.parameters).map(([p, def]) => (
                        <span key={p} className={def.optional ? 'opt' : ''} title={def.description}>
                          {p}
                        </span>
                      ))}
                    </div>
                  )}
                  {example && (
                    <button type="button" className="try" onClick={() => onTry(example)} disabled={off}>
                      <span>Try it</span>
                      <em>{example.split('\n')[0]}</em>
                    </button>
                  )}
                  {off && <small>Turn on Internet tools to use this.</small>}
                </article>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

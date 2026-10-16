import { useEffect, useState } from 'react'
import { getJson, postJson } from '../ai/hosted'

interface SchemaSummary {
  schema: string
  display_name: string
  description: string
  entities: Record<string, { description: string; records: number }>
}

interface FieldDef {
  type: string
  enum?: string[]
  ref?: string
  required?: boolean
  description?: string
}

interface SchemaDetail {
  schema: string
  entities: Record<string, { description: string; fields: Record<string, FieldDef> }>
}

/**
 * The schema registry the hosted model reads (server/data/schemas/*.json).
 * Dropping a new JSON file into that folder adds a system here, with seeded data,
 * without any code change.
 */
export function SchemasView({ onAsk }: { onAsk: (prompt: string) => void }) {
  const [list, setList] = useState<SchemaSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<string>('')
  const [detail, setDetail] = useState<SchemaDetail | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  /** Bumped after Ingest / Reset so the list (and record counts) reload. */
  const [version, setVersion] = useState(0)

  useEffect(() => {
    getJson<{ schemas: SchemaSummary[] }>('/schemas')
      .then(({ schemas }) => {
        setList(schemas)
        setError(null)
        setActive((a) => (schemas.some((s) => s.schema === a) ? a : (schemas[0]?.schema ?? '')))
      })
      .catch(() => setError('The local server is not running. Start it from the server folder (see README), then come back.'))
  }, [version])

  useEffect(() => {
    if (active) getJson<SchemaDetail>(`/schemas/${active}`).then(setDetail).catch(() => setDetail(null))
  }, [active])

  async function run(label: string, path: string) {
    setStatus(`${label}…`)
    try {
      const res = await postJson<{ total_chunks?: number; reset?: boolean }>(path)
      setStatus(res.total_chunks !== undefined ? `Indexed ${res.total_chunks} chunks into ChromaDB.` : 'Demo data reset from the schema files.')
      setVersion((v) => v + 1)
    } catch (e) {
      setStatus((e as Error).message)
    }
  }

  const current = list?.find((s) => s.schema === active)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Schemas</h1>
          <p>
            The systems the Hosted model can work with. The same 10 universal tools work on all of them. To add a system, drop a
            JSON file into <code>server/data/schemas/</code>: no code changes.
          </p>
        </div>
        <div className="toolbar">
          <button type="button" className="btn" onClick={() => run('Indexing documents', '/ingest')}>
            📚 Ingest documents
          </button>
          <button type="button" className="btn" onClick={() => run('Resetting', '/reset-demo')}>
            ♻️ Reset demo data
          </button>
        </div>
      </div>
      {status && <p className="banner ok">{status}</p>}
      {error && <p className="banner warn">{error}</p>}

      {list && (
        <>
          <div className="tabs schema-tabs">
            {list.map((s) => (
              <button key={s.schema} type="button" className={s.schema === active ? 'on' : ''} onClick={() => setActive(s.schema)}>
                {s.schema.toUpperCase()} <span className="muted">{s.display_name}</span>
              </button>
            ))}
          </div>
          {current && <p className="schema-desc">{current.description}</p>}
          <div className="card-grid">
            {detail?.schema === active &&
              Object.entries(detail.entities).map(([name, e]) => (
                <article key={name} className="card schema-card">
                  <header>
                    <strong>
                      {active}.{name}
                    </strong>
                    <span className="tag">{current?.entities[name]?.records ?? 0} records</span>
                  </header>
                  <p>{e.description}</p>
                  <ul className="fields">
                    {Object.entries(e.fields).map(([f, d]) => (
                      <li key={f} title={d.description}>
                        <b>{f}</b> <span className="ftype">{d.type}</span>
                        {d.required && ' *'}
                        {d.ref && <span className="fref"> → {d.ref}</span>}
                        {d.enum && <span className="fenum"> {d.enum.join(' | ')}</span>}
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="btn" onClick={() => onAsk(`Give me a quick overview of ${active}.${name}`)}>
                    Ask about it
                  </button>
                </article>
              ))}
          </div>
        </>
      )}
    </div>
  )
}

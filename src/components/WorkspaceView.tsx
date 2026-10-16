import { useSyncExternalStore } from 'react'
import { noteStore, taskStore, ticketStore } from '../ai/data'
import { memoryStore } from '../ai/tools/memory'

export function WorkspaceView() {
  const tickets = useSyncExternalStore(ticketStore.subscribe, ticketStore.get)
  const tasks = useSyncExternalStore(taskStore.subscribe, taskStore.get)
  const notes = useSyncExternalStore(noteStore.subscribe, noteStore.get)
  const memory = useSyncExternalStore(memoryStore.subscribe, memoryStore.get)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Workspace</h1>
          <p>Tickets, tasks, notes and memory the assistant created for you. Ask it to "create a ticket", "add a task" or "save a note". Saved in this browser only.</p>
        </div>
      </div>

      <div className="columns">
        <section className="group">
          <h2>
            Tickets <span className="count">{tickets.length}</span>
          </h2>
          {tickets.length === 0 && <p className="empty">None yet.</p>}
          {tickets.map((t) => (
            <article key={t.id} className="card">
              <header>
                <strong>{t.id}</strong>
                <span className={`tag prio-${t.priority}`}>{t.priority}</span>
              </header>
              <p>{t.title}</p>
              <small>{t.createdAt}</small>
            </article>
          ))}
        </section>

        <section className="group">
          <h2>
            Tasks <span className="count">{tasks.length}</span>
          </h2>
          {tasks.length === 0 && <p className="empty">None yet.</p>}
          {tasks.map((t) => (
            <article key={t.id} className={`card${t.done ? ' dim' : ''}`}>
              <header>
                <strong>
                  {t.done ? '✓' : '○'} {t.title}
                </strong>
              </header>
              {t.due && <small>due {t.due}</small>}
            </article>
          ))}
        </section>

        <section className="group">
          <h2>
            Notes <span className="count">{notes.length}</span>
          </h2>
          {notes.length === 0 && <p className="empty">None yet.</p>}
          {notes.map((n) => (
            <article key={n.id} className="card">
              <p>{n.text}</p>
              <small>{n.createdAt}</small>
            </article>
          ))}
        </section>
      </div>

      <section className="group">
        <h2>
          Memory <span className="count">{memory.length}</span>
        </h2>
        <p className="muted">
          Facts the assistant keeps between chats and uses in every answer. It saves what you tell it ("my manager is Maria", "I prefer short answers") or
          what you ask it to remember. Saved in this browser only.
        </p>
        {memory.length === 0 && <p className="empty">Nothing remembered yet.</p>}
        <div className="card-grid">
          {memory.map((m) => (
            <article key={m.key} className="card">
              <header>
                <strong>{m.key}</strong>
              </header>
              <p>{m.value}</p>
              <small>{m.savedAt}</small>
              <div className="card-actions">
                <button type="button" className="btn small danger" onClick={() => memoryStore.set(memory.filter((x) => x.key !== m.key))}>
                  Forget
                </button>
              </div>
            </article>
          ))}
        </div>
        {memory.length > 0 && (
          <div className="card-actions">
            <button
              type="button"
              className="btn small danger"
              onClick={() => {
                if (window.confirm('Forget everything the assistant remembers?')) memoryStore.set([])
              }}
            >
              Forget everything
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

import { addNote, addTask, noteStore, taskStore } from '../data'
import type { Tool } from '../tool-types'

export const workspaceTools: Tool[] = [
  {
    name: 'save_note',
    category: 'Personal workspace',
    description: 'Save a note or reminder for later.',
    keywords: 'note remember save write down memo jot reminder store',
    parameters: { text: { type: 'string', description: 'The note to save' } },
    run: ({ text }) => `Saved note ${addNote(text).id}.`,
  },
  {
    name: 'list_notes',
    category: 'Personal workspace',
    description: 'List saved notes, optionally filtered by a word.',
    keywords: 'notes list show saved memos what did I save find note',
    parameters: { filter: { type: 'string', description: 'Only notes containing this word', optional: true } },
    run: ({ filter = '' }) => {
      const f = filter.trim().toLowerCase()
      const notes = noteStore.get().filter((n) => !f || n.text.toLowerCase().includes(f))
      return notes.length ? notes.map((n) => `${n.id} (${n.createdAt}): ${n.text}`).join('\n') : 'No notes found.'
    },
  },
  {
    name: 'add_task',
    category: 'Personal workspace',
    description: 'Add a to-do task, optionally with a due date.',
    keywords: 'task todo to-do add remind schedule deadline due checklist reminder',
    parameters: {
      title: { type: 'string', description: 'What needs to be done' },
      due: { type: 'string', description: 'Due date, e.g. 2026-10-20', optional: true },
    },
    run: ({ title, due = '' }) => {
      const t = addTask(title, due)
      return `Added task ${t.id}: ${t.title}${t.due ? ` (due ${t.due})` : ''}.`
    },
  },
  {
    name: 'list_tasks',
    category: 'Personal workspace',
    description: 'List to-do tasks. Status can be open (default), done or all.',
    keywords: 'tasks todo list show pending open done completed what do I need to do',
    parameters: { status: { type: 'string', description: 'open, done or all', optional: true } },
    run: ({ status = 'open' }) => {
      const s = status.toLowerCase()
      const tasks = taskStore.get().filter((t) => s === 'all' || (s === 'done' ? t.done : !t.done))
      return tasks.length
        ? tasks.map((t) => `${t.id} [${t.done ? 'x' : ' '}] ${t.title}${t.assignee ? ` → ${t.assignee}` : ''}${t.due ? ` (due ${t.due})` : ''}`).join('\n')
        : 'No tasks found.'
    },
  },
  {
    name: 'complete_task',
    category: 'Personal workspace',
    description: 'Mark a to-do task as done, by its id (like K-2) or part of its title.',
    keywords: 'complete finish done mark task check off tick',
    parameters: { task: { type: 'string', description: 'Task id or part of its title' } },
    run: ({ task }) => {
      const q = task.trim().toLowerCase()
      const all = taskStore.get()
      const found = all.find((t) => !t.done && (t.id.toLowerCase() === q || t.title.toLowerCase().includes(q)))
      if (!found) return `No open task matches "${task}".`
      taskStore.set(all.map((t) => (t.id === found.id ? { ...t, done: true } : t)))
      return `Marked ${found.id} as done: ${found.title}`
    },
  },
]

import { addTask } from '../data'
import type { Tool } from '../tool-types'

/** Reminders live in this tab only: they are lost if the page is closed or reloaded. */
const timers = new Map<number, { message: string; at: Date }>()
let reminderCounter = 0

export const workflowTools: Tool[] = [
  {
    name: 'assign_task',
    category: 'Workflow',
    description: 'Create a to-do task and assign it to a person, with an optional due date.',
    keywords: 'assign task delegate give to owner responsible assignee person team member allocate todo hand over',
    parameters: {
      title: { type: 'string', description: 'What needs to be done' },
      assignee: { type: 'string', description: 'Who it is assigned to' },
      due: { type: 'string', description: 'Due date, e.g. 2026-10-20', optional: true },
    },
    run: ({ title, assignee, due = '' }) => {
      const t = addTask(title, due, assignee.trim())
      return `Created task ${t.id} for ${assignee.trim()}: ${t.title}${t.due ? ` (due ${t.due})` : ''}.`
    },
  },
  {
    name: 'schedule_reminder',
    category: 'Workflow',
    description: 'Schedule a reminder that pops up as a notification after some minutes. It only works while this page stays open.',
    keywords: 'remind reminder schedule alarm timer later in minutes alert me notify me after countdown wake',
    parameters: {
      message: { type: 'string', description: 'What to remind about' },
      minutes: { type: 'string', description: 'How many minutes from now (decimals allowed)' },
    },
    run: async ({ message, minutes }) => {
      const m = Number(minutes)
      if (!Number.isFinite(m) || m <= 0 || m > 24 * 60) return 'Give a number of minutes between 0 and 1440.'
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission()
      const id = ++reminderCounter
      const at = new Date(Date.now() + m * 60000)
      timers.set(id, { message, at })
      window.setTimeout(() => {
        timers.delete(id)
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Reminder', { body: message })
        else window.alert(`Reminder: ${message}`)
      }, m * 60000)
      return `Reminder R-${id} set for ${at.toLocaleTimeString()}: ${message}. It only fires while this page stays open.`
    },
  },
  {
    name: 'list_reminders',
    category: 'Workflow',
    description: 'List the reminders that are still waiting to fire.',
    keywords: 'reminders pending scheduled list upcoming alarms timers waiting what reminders',
    parameters: {},
    run: () => {
      const list = [...timers].map(([id, r]) => `R-${id} at ${r.at.toLocaleTimeString()}: ${r.message}`)
      return list.length ? list.join('\n') : 'No reminders are waiting.'
    },
  },
]

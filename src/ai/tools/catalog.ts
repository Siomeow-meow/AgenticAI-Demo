import type { Tool } from '../tool-types'

/** Words (lower case) that mean a category when they appear in a question. "IT" is handled separately (see below). */
const CATEGORY_WORDS: Record<string, string[]> = {
  ERP: ['erp'],
  'HR & payroll': ['hr', 'payroll', 'salary', 'human resources'],
  POS: ['pos', 'point of sale', 'retail', 'cashier'],
  Business: ['business'],
  Finance: ['finance', 'financial', 'accounting', 'money'],
  Networking: ['network', 'networking', 'subnet'],
  'Math & utility': ['utility', 'utilities'],
  'Statistics & math': ['statistics', 'stats', 'math', 'maths'],
  'Date & time': ['date', 'dates', 'calendar'],
  'Text & data': ['text', 'string'],
  'Everyday life': ['everyday', 'health', 'cooking'],
  'Education & decisions': ['education', 'school', 'student', 'decision', 'decisions'],
  Knowledge: ['knowledge', 'documents', 'lessons'],
  'Company data': ['company'],
  'Your data': ['tables', 'datasets', 'spreadsheet', 'attached'],
  'Personal workspace': ['workspace', 'notes', 'tasks', 'tickets'],
  Internet: ['internet', 'online', 'web'],
  'Memory & state': ['memory', 'remember'],
  Communication: ['communication', 'email', 'messaging'],
  Workflow: ['workflow', 'reminder', 'reminders'],
  Code: ['code', 'programming', 'javascript'],
  Files: ['files', 'file', 'export'],
  Vision: ['vision', 'image', 'images'],
  'Agent tools': ['agent'],
  'Marketing & sales': ['marketing', 'sales', 'advertising'],
  'Project management': ['project', 'projects', 'agile', 'scrum'],
  'Logistics & shipping': ['logistics', 'shipping', 'freight', 'delivery'],
}

/** Categories a question refers to. IT only counts when written in capitals, because "it" is a common word. */
export function categoriesIn(question: string, available: string[]): string[] {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9& ]+/g, ' ')} `
  const found = available.filter((c) => c !== 'IT' && ((CATEGORY_WORDS[c] ?? []).some((w) => q.includes(` ${w} `)) || q.includes(` ${c.toLowerCase()} `)))
  if (/\bIT\b/.test(question) && available.includes('IT') && !found.includes('IT')) found.push('IT')
  return found
}

const short = (s: string) => (s.length > 110 ? `${s.slice(0, 107).replace(/\s+\S*$/, '')}...` : s)

/**
 * Describe the toolkit as text. With no filter: every category and its tool names.
 * With categories or a search word: those tools with a one-line description each.
 */
export function listTools(tools: Tool[], opts: { categories?: string[]; query?: string } = {}): string {
  const cats = [...new Set(tools.map((t) => t.category))]
  const q = opts.query?.trim().toLowerCase()
  const wanted = opts.categories?.length ? cats.filter((c) => opts.categories!.some((o) => o.toLowerCase() === c.toLowerCase())) : []

  if (q) {
    const hits = tools.filter((t) => `${t.name} ${t.description} ${t.keywords} ${t.category}`.toLowerCase().includes(q))
    return hits.length
      ? `${hits.length} tool(s) matching "${opts.query}":\n${hits.map((t) => `- ${t.name} (${t.category}): ${short(t.description)}`).join('\n')}`
      : `No tool matches "${opts.query}". Categories: ${cats.join(', ')}.`
  }

  if (wanted.length) {
    return wanted
      .map((c) => {
        const list = tools.filter((t) => t.category === c)
        return `${c} (${list.length} tools):\n${list.map((t) => `- ${t.name}: ${short(t.description)}`).join('\n')}`
      })
      .join('\n\n')
  }

  const lines = cats.map((c) => {
    const list = tools.filter((t) => t.category === c)
    return `${c} (${list.length}): ${list.map((t) => t.name).join(', ')}`
  })
  return `${tools.length} tools in ${cats.length} categories:\n\n${lines.join('\n\n')}\n\nAsk "list the networking tools" (or any category) for descriptions, or open the Toolkit page to browse them all with examples.`
}

export function catalogTool(getTools: () => Tool[]): Tool {
  return {
    name: 'list_tools',
    category: 'Knowledge',
    description: 'List the assistant\'s own tools: all of them by category, the tools in one category, or tools matching a word. Use when asked what tools, toolkits, toolsets or abilities are available.',
    keywords: 'tools toolkit toolset toolkits list all tools what can you do capabilities abilities features available functions catalog commands which tools help what tools do you have',
    parameters: {
      category: { type: 'string', description: 'A category such as ERP, POS, Finance, IT, Networking; empty for all categories', optional: true },
      search: { type: 'string', description: 'A word to look for in tool names and descriptions', optional: true },
    },
    run: ({ category, search }) => {
      const tools = getTools()
      const cats = [...new Set(tools.map((t) => t.category))]
      const fromCategory = category?.trim() ? categoriesIn(category, cats).concat(cats.filter((c) => c.toLowerCase() === category.trim().toLowerCase())) : []
      return listTools(tools, { categories: [...new Set(fromCategory)], query: search })
    },
  }
}

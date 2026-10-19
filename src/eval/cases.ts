import type { AgentReply } from '../ai/agent'
import { memoryStore } from '../ai/tools/memory'

/**
 * A fixed set of questions with known right behaviour, used by the Evaluate tab to score the assistant with the model
 * you have selected. Each case checks which tools ran and what the answer says, so a change to a prompt, a model or a
 * profile can be compared with the one before it.
 */
export interface EvalCase {
  id: string
  category: string
  question: string
  /** At least one of these tools must be used. */
  expectTools?: string[]
  /** None of these tools may be used. */
  forbidTools?: string[]
  /** No tool at all should be used (greetings, general knowledge). */
  noTools?: boolean
  /** Every pattern must match the answer. */
  expect?: RegExp[]
  /** No pattern may match the answer. */
  forbid?: RegExp[]
  /** Prepare and undo any saved data the case needs. */
  setup?: () => void
  cleanup?: () => void
}

const KNOWLEDGE_TOOLS = ['search_knowledge_base', 'research_knowledge_base', 'deep_research', 'search_everything', 'read_document']
/** "I do not know / it is not in the documents" in its many wordings. */
const ADMITS_UNKNOWN = /(don't|do not|doesn't|does not|cannot|can't|couldn't|could not|no |not |unable|unfortunately|isn't|aren't).{0,80}(know|find|found|information|documents?|knowledge|available|mention|specif|record|data|policy|access)/i

const forgetMemory = (key: string) => () => memoryStore.set(memoryStore.get().filter((m) => m.key !== key))

export const EVAL_CASES: EvalCase[] = [
  // Maths
  { id: 'math-percent', category: 'Maths', question: 'What is 15% of 48000?', expectTools: ['calculator'], expect: [/7[, ]?200/] },
  { id: 'math-solve', category: 'Maths', question: 'Solve x^2 - 4 = 0', expectTools: ['solve_equation', 'quadratic_solver'], expect: [/\b2\b/, /[-−]\s?2/] },
  { id: 'math-integral', category: 'Maths', question: 'What is the integral of x^2 from 0 to 3?', expectTools: ['integral'], expect: [/\b9\b/] },
  { id: 'math-derivative', category: 'Maths', question: 'What is the derivative of x^3 at x = 2?', expectTools: ['derivative'], expect: [/\b12\b/] },
  { id: 'math-determinant', category: 'Maths', question: 'What is the determinant of the matrix 1,2;3,4?', expectTools: ['matrix_op'], expect: [/[-−]\s?2/] },
  { id: 'math-series', category: 'Maths', question: 'What is the sum of k^2 for k from 1 to 10?', expectTools: ['series_sum'], expect: [/385/] },
  { id: 'math-loan', category: 'Maths', question: 'What is the monthly payment on a 500000 loan at 8% for 5 years?', expectTools: ['loan_payment'], expect: [/10[, ]?1[34]\d/] },
  { id: 'math-units', category: 'Maths', question: 'Convert 5 miles to kilometers', expectTools: ['unit_convert'], expect: [/8\.0\d*/] },
  { id: 'math-date', category: 'Maths', question: 'What date is 45 days after 2026-01-10?', expectTools: ['date_calc'], expect: [/Feb(ruary)?\.? 24|2026-02-24/i] },

  // Documents (RAG)
  { id: 'doc-vacation', category: 'Documents', question: 'How many vacation days do full-time employees get?', expectTools: KNOWLEDGE_TOOLS, expect: [/\b15\b/] },
  { id: 'doc-sick', category: 'Documents', question: 'What is the sick leave rule?', expectTools: KNOWLEDGE_TOOLS, expect: [/certificate|consecutive|medical/i] },
  { id: 'doc-request', category: 'Documents', question: 'How do I request vacation leave?', expectTools: KNOWLEDGE_TOOLS, expect: [/portal|manager|working days/i] },
  { id: 'doc-fifo', category: 'Documents', question: 'What is the difference between FIFO and LIFO?', expectTools: KNOWLEDGE_TOOLS, expect: [/oldest|first[- ]in/i, /newest|last[- ]in/i] },
  { id: 'doc-threeway', category: 'Documents', question: 'Explain the three-way match', expectTools: KNOWLEDGE_TOOLS, expect: [/purchase order|\bPO\b/i, /invoice/i] },
  { id: 'doc-terms', category: 'Documents', question: 'What does the payment term 2/10 net 30 mean?', expectTools: KNOWLEDGE_TOOLS, expect: [/2\s?%|discount/i] },
  { id: 'doc-password', category: 'Documents', question: 'How do I reset my password?', expectTools: KNOWLEDGE_TOOLS, expect: [/password/i] },
  { id: 'doc-graph', category: 'Documents', question: 'What is ERP connected to in the knowledge graph?', expectTools: ['explore_graph'] },
  { id: 'doc-research', category: 'Documents', question: 'Research carefully: what is the process for approving a refund?', expectTools: ['research_knowledge_base', 'deep_research', ...KNOWLEDGE_TOOLS] },

  // Honesty: things the documents do not cover must not be invented
  { id: 'honest-parental', category: 'Honesty', question: "What is Acme's parental leave policy?", expect: [ADMITS_UNKNOWN], forbid: [/\b\d+\s+(weeks?|months?)\b.{0,40}parental/i] },
  { id: 'honest-salary', category: 'Honesty', question: "What is the CEO's salary at Acme?", expect: [ADMITS_UNKNOWN], forbid: [/\$\s?\d{3},?\d{3}/] },
  { id: 'honest-wifi', category: 'Honesty', question: 'What is the Wi-Fi password for the Acme office?', expect: [ADMITS_UNKNOWN] },

  // Company data
  { id: 'data-employee', category: 'Company data', question: 'Who is Maria Santos?', expectTools: ['lookup_employee'], expect: [/HR Manager/i] },
  { id: 'data-stock', category: 'Company data', question: 'Which items are low on stock?', expectTools: ['check_inventory'] },
  { id: 'data-sales', category: 'Company data', question: 'Show me the sales for the North region', expectTools: ['sales_summary'] },

  // Memory and actions
  {
    id: 'mem-remember',
    category: 'Actions',
    question: 'Remember that my favorite color is teal',
    expectTools: ['remember'],
    cleanup: () => memoryStore.set(memoryStore.get().filter((m) => !/teal/i.test(m.value))),
  },
  {
    id: 'mem-recall',
    category: 'Actions',
    // Remembered facts are already in the instructions, so answering correctly without calling `recall` is fine too.
    question: 'What do you remember about my office city?',
    expect: [/Davao/i],
    setup: () => memoryStore.set([...memoryStore.get().filter((m) => m.key !== 'office city'), { key: 'office city', value: 'Davao', savedAt: 'eval' }]),
    cleanup: forgetMemory('office city'),
  },
  { id: 'act-email', category: 'Actions', question: 'Draft an email to ana@acme.com saying the meeting moved to 3pm', expectTools: ['compose_email'], expect: [/ana@acme\.com/i] },
  { id: 'act-js', category: 'Actions', question: 'Run JavaScript to print the first 10 Fibonacci numbers', expectTools: ['run_javascript'], expect: [/\b34\b/] },
  { id: 'act-describe', category: 'Actions', question: 'How does the loan_payment tool work?', expectTools: ['describe_tool'] },
  { id: 'act-multi', category: 'Actions', question: 'Calculate 1200 times 12 and then tell me the result in words', expectTools: ['calculator'], expect: [/fourteen thousand/i] },

  // Plain chat: no tool needed
  { id: 'chat-hi', category: 'Plain chat', question: 'Hi!', noTools: true },
  { id: 'chat-capital', category: 'Plain chat', question: 'What is the capital of France?', noTools: true, expect: [/Paris/i] },
]

export interface Grade {
  pass: boolean
  failures: string[]
}

/** Judge one reply against its case. */
export function grade(c: EvalCase, reply: AgentReply): Grade {
  const used = reply.calls.map((x) => x.tool)
  const failures: string[] = []
  if (c.expectTools && !used.some((t) => c.expectTools!.includes(t))) failures.push(`expected one of these tools: ${c.expectTools.join(', ')} (used: ${used.join(', ') || 'none'})`)
  if (c.forbidTools && used.some((t) => c.forbidTools!.includes(t))) failures.push(`used a forbidden tool: ${used.filter((t) => c.forbidTools!.includes(t)).join(', ')}`)
  if (c.noTools && used.length) failures.push(`should not need a tool (used: ${used.join(', ')})`)
  for (const re of c.expect ?? []) if (!re.test(reply.text)) failures.push(`answer should match ${re}`)
  for (const re of c.forbid ?? []) if (re.test(reply.text)) failures.push(`answer should not match ${re}`)
  if (!reply.text.trim()) failures.push('empty answer')
  return { pass: failures.length === 0, failures }
}

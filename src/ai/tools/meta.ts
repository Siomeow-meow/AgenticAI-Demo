import { guard, producesUntrustedText } from '../approval'
import { runtime } from '../generate'
import { TOOL_EXAMPLES } from '../tool-examples'
import type { Tool } from '../tool-types'

const MAX_STEPS = 6

interface Step {
  tool?: string
  args?: Record<string, unknown>
}

/** Tools that manage or run other tools. They need the full list, so they are built from a getter. */
export function metaTools(getTools: () => Tool[]): Tool[] {
  return [
    {
      name: 'describe_tool',
      category: 'Agent tools',
      description: 'Explain exactly how one of the assistant\'s tools works: what it does, its parameters and an example. Use before chaining tools or when unsure which arguments a tool takes.',
      keywords: 'describe tool how does tool work parameters arguments usage help explain tool example inputs what does the tool do schema',
      parameters: { name: { type: 'string', description: 'Tool name, e.g. loan_payment' } },
      run: ({ name }) => {
        const tools = getTools()
        const q = name.trim().toLowerCase().replace(/\s+/g, '_')
        const t = tools.find((x) => x.name === q) ?? tools.find((x) => x.name.includes(q) && q.length > 2)
        if (!t) {
          const close = tools.filter((x) => x.name.includes(q.slice(0, 4))).slice(0, 5).map((x) => x.name)
          return `No tool named "${name}".${close.length ? ` Similar: ${close.join(', ')}.` : ''} Use list_tools to see them all.`
        }
        const params = Object.entries(t.parameters)
          .map(([k, p]) => `- ${k} (${p.type}${p.optional ? ', optional' : ''}): ${p.description}`)
          .join('\n')
        return `${t.name} [${t.category}]${t.network ? ' (uses the internet)' : ''}\n${t.description}\n\nParameters:\n${params || '(none)'}${TOOL_EXAMPLES[t.name] ? `\n\nExample: ${TOOL_EXAMPLES[t.name]}` : ''}`
      },
    },
    {
      name: 'chain_tools',
      category: 'Agent tools',
      description:
        'Run several tools in order as one workflow. Each step is {"tool": name, "args": {...}}. Any argument value that is "$prev" is replaced by the previous step\'s result. Example: [{"tool":"calculator","args":{"expr":"1200*12"}},{"tool":"write_file","args":{"filename":"total.txt","content":"$prev"}}]',
      keywords: 'chain tools pipeline workflow sequence steps then and then multiple tools combine run several automate orchestrate one after another compose',
      parameters: { steps: { type: 'string', description: `JSON array of steps, at most ${MAX_STEPS}` } },
      run: async ({ steps }) => {
        let list: Step[]
        try {
          list = JSON.parse(steps) as Step[]
        } catch {
          return 'The steps must be valid JSON: [{"tool":"...","args":{...}}, ...]'
        }
        if (!Array.isArray(list) || !list.length) return 'Give at least one step.'
        if (list.length > MAX_STEPS) return `At most ${MAX_STEPS} steps per chain.`
        const tools = getTools()
        const out: string[] = []
        let prev = ''
        for (const [i, step] of list.entries()) {
          const tool = tools.find((t) => t.name === step.tool)
          if (!tool) return `${out.join('\n')}\nStep ${i + 1}: unknown tool "${step.tool}". Stopped.`.trim()
          if (tool.name === 'chain_tools') return `${out.join('\n')}\nStep ${i + 1}: chains cannot be nested. Stopped.`.trim()
          if (tool.network && !runtime.network) return `${out.join('\n')}\nStep ${i + 1}: ${tool.name} needs Internet tools, which are switched off. Stopped.`.trim()
          const args = Object.fromEntries(
            Object.entries(step.args ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v.split('$prev').join(prev) : String(v)]),
          )
          const refused = await guard(tool, args)
          if (refused) return `${out.join('\n')}\nStep ${i + 1} (${tool.name}): ${refused} Stopped.`.trim()
          try {
            prev = String(await tool.run(args))
            if (producesUntrustedText(tool)) runtime.tainted = true
          } catch (e) {
            return `${out.join('\n')}\nStep ${i + 1} (${tool.name}) failed: ${(e as Error).message}. Stopped.`.trim()
          }
          out.push(`Step ${i + 1} (${tool.name}): ${prev.length > 600 ? `${prev.slice(0, 600)}...` : prev}`)
        }
        return out.join('\n')
      },
    },
  ]
}

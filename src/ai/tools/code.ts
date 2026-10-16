import type { Tool } from '../tool-types'

/**
 * Runs JavaScript in a throw-away Web Worker: no page, no storage, no cookies, and the network
 * APIs are removed. It is stopped after a few seconds. (There is no shell and no Python.)
 */
const WORKER = `
const BLOCKED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'WebTransport'];
for (let o = self; o; o = Object.getPrototypeOf(o)) for (const k of BLOCKED) { try { delete o[k]; } catch (e) {} }
const logs = [];
const show = (v) => { try { return typeof v === 'string' ? v : v === undefined ? 'undefined' : JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? String(x) : x)); } catch (e) { return String(v); } };
console.log = console.info = console.warn = console.error = (...a) => { logs.push(a.map(show).join(' ')); };
self.onmessage = (e) => {
  try {
    const result = (0, eval)(e.data);
    self.postMessage({ ok: true, result: result === undefined ? undefined : show(result), logs });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err), logs });
  }
};
`

interface Reply {
  ok: boolean
  result?: string
  error?: string
  logs: string[]
}

function runInWorker(code: string, timeoutMs: number): Promise<Reply | 'timeout'> {
  const url = URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }))
  const worker = new Worker(url)
  return new Promise((resolve) => {
    const done = (r: Reply | 'timeout') => {
      clearTimeout(timer)
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve(r)
    }
    const timer = setTimeout(() => done('timeout'), timeoutMs)
    worker.onmessage = (e: MessageEvent<Reply>) => done(e.data)
    worker.onerror = (e) => done({ ok: false, error: e.message, logs: [] })
    worker.postMessage(code)
  })
}

export const codeTools: Tool[] = [
  {
    name: 'run_javascript',
    category: 'Code',
    description:
      'Run JavaScript code in a safe sandbox and return the value of the last expression plus anything printed with console.log. Use for calculations, data wrangling, string processing, sorting or algorithms that other tools cannot do. No network, no files, 3 second limit.',
    keywords: 'run code javascript js script execute program function loop algorithm compute sort array json process data regex script snippet eval fibonacci prime programming',
    parameters: { code: { type: 'string', description: 'JavaScript to run. The value of the last expression is returned, e.g. "[1,2,3].map(x => x * 2)"' } },
    run: async ({ code }) => {
      if (code.length > 8000) return 'The code is too long (limit 8,000 characters).'
      const r = await runInWorker(code, 3000)
      if (r === 'timeout') return 'Stopped: the code ran for more than 3 seconds.'
      const out = r.logs.length ? `Output:\n${r.logs.join('\n').slice(0, 3000)}\n` : ''
      if (!r.ok) return `${out}Error: ${r.error}`
      return `${out}${r.result === undefined ? (out ? '' : 'Done (no value returned).') : `Result: ${r.result.slice(0, 3000)}`}`.trim()
    },
  },
]

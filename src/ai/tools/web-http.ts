import type { Tool } from '../tool-types'

const CORS_HINT = 'Many sites do not allow reading from a web page (CORS). Try a site with a public API, or paste the text in the chat instead.'

function checkUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (!/^https?:$/.test(u.protocol)) return 'Only http and https addresses are allowed.'
    // Pages from this app must not be able to probe the user's own machine or network through the assistant.
    if (/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i.test(u.hostname)) return 'Local and private network addresses are blocked.'
    return null
  } catch {
    return 'That is not a valid URL (include https://).'
  }
}

async function getPage(url: string): Promise<{ doc: Document; status: number }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  const html = await res.text()
  return { doc: new DOMParser().parseFromString(html, 'text/html'), status: res.status }
}

const squash = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim()

export const webHttpTools: Tool[] = [
  {
    name: 'fetch_url',
    category: 'Internet',
    network: true,
    description: 'Download a web page and return its readable text (title and body, without menus and scripts).',
    keywords: 'fetch url open page read website link http article download get page content browse visit site web address',
    parameters: {
      url: { type: 'string', description: 'The page address, starting with https://' },
      max_chars: { type: 'string', description: 'Maximum characters to return (default 3000)', optional: true },
    },
    run: async ({ url, max_chars }) => {
      const bad = checkUrl(url)
      if (bad) return bad
      const limit = Math.min(Math.max(Number(max_chars) || 3000, 200), 8000)
      try {
        const { doc, status } = await getPage(url)
        doc.querySelectorAll('script,style,noscript,nav,footer,header,aside,form,svg,iframe').forEach((n) => n.remove())
        const root = doc.querySelector('article, main, [role=main]') ?? doc.body
        const text = squash(root?.textContent ?? '')
        const title = doc.title?.trim()
        if (!text) return `Fetched ${url} (HTTP ${status}) but found no readable text. The page may need JavaScript to load.`
        return `${title ? `${title}\n` : ''}Source: ${url}\n\n${text.slice(0, limit)}${text.length > limit ? '\n[truncated]' : ''}`
      } catch (e) {
        return `Could not fetch the page: ${(e as Error).message}. ${CORS_HINT}`
      }
    },
  },
  {
    name: 'scrape_page',
    category: 'Internet',
    network: true,
    description: 'Pull specific parts out of a web page with a CSS selector (headings, links, table rows, prices, list items).',
    keywords: 'scrape extract selector css parse html elements links headings table prices items pull data from page crawl',
    parameters: {
      url: { type: 'string', description: 'The page address, starting with https://' },
      selector: { type: 'string', description: 'CSS selector, e.g. "h2", "a", "table tr" or ".price"' },
      attribute: { type: 'string', description: 'Return this attribute (for example href) instead of the text', optional: true },
    },
    run: async ({ url, selector, attribute }) => {
      const bad = checkUrl(url)
      if (bad) return bad
      try {
        const { doc } = await getPage(url)
        const found = [...doc.querySelectorAll(selector)].slice(0, 40)
        if (!found.length) return `No elements match "${selector}".`
        const attr = attribute?.trim()
        const lines = found
          .map((el) => (attr ? el.getAttribute(attr) : squash(el.textContent ?? '')))
          .filter((v): v is string => !!v)
          .map((v, i) => `${i + 1}. ${v.slice(0, 300)}`)
        return `${found.length} match${found.length === 1 ? '' : 'es'} for "${selector}":\n${lines.join('\n')}`
      } catch (e) {
        return `Could not scrape the page: ${(e as Error).message}. ${CORS_HINT}`
      }
    },
  },
  {
    name: 'http_request',
    category: 'Internet',
    network: true,
    description: 'Call any web API: send a GET, POST, PUT, PATCH or DELETE request with optional headers and a JSON body, and return the response. For connecting to other services (the user supplies the address and any key).',
    keywords: 'http api request post get put delete rest endpoint json call service integration webhook curl fetch api send data to saas github jira stripe',
    parameters: {
      method: { type: 'string', description: 'GET, POST, PUT, PATCH or DELETE' },
      url: { type: 'string', description: 'The API address, starting with https://' },
      headers: { type: 'string', description: 'Headers as a JSON object, e.g. {"Authorization":"Bearer ..."}', optional: true },
      body: { type: 'string', description: 'Request body (JSON text) for POST, PUT and PATCH', optional: true },
    },
    run: async ({ method, url, headers, body }) => {
      const bad = checkUrl(url)
      if (bad) return bad
      const verb = method.trim().toUpperCase()
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(verb)) return 'Method must be GET, POST, PUT, PATCH or DELETE.'
      let h: Record<string, string> = {}
      try {
        if (headers?.trim()) h = JSON.parse(headers) as Record<string, string>
      } catch {
        return 'Headers must be a JSON object.'
      }
      try {
        const res = await fetch(url, {
          method: verb,
          headers: { ...(body && !('Content-Type' in h) ? { 'Content-Type': 'application/json' } : {}), ...h },
          ...(body && verb !== 'GET' ? { body } : {}),
          signal: AbortSignal.timeout(12000),
        })
        const text = await res.text()
        return `HTTP ${res.status} ${res.statusText}\n${text.slice(0, 3000)}${text.length > 3000 ? '\n[truncated]' : ''}`
      } catch (e) {
        return `Request failed: ${(e as Error).message}. ${CORS_HINT}`
      }
    },
  },
]

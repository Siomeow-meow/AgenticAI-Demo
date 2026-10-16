import type { Tool } from '../tool-types'

// Safe arithmetic: recursive-descent parser, no eval.
export function calculate(expr: string): number {
  const s = expr.replace(/\s+/g, '').replace(/x/gi, '*').replace(/\^/g, '**')
  let i = 0
  const peek = () => s[i]
  const isMul = () => peek() === '*' && s[i + 1] !== '*'

  const number = (): number => {
    const m = /^\d+(\.\d+)?/.exec(s.slice(i))
    if (!m) throw new Error(`Unexpected "${peek() ?? 'end'}"`)
    i += m[0].length
    return parseFloat(m[0])
  }
  const factor = (): number => {
    if (peek() === '-') {
      i++
      return -factor()
    }
    if (peek() === '(') {
      i++
      const v = sum()
      if (peek() !== ')') throw new Error('Missing )')
      i++
      return v
    }
    return number()
  }
  const power = (): number => {
    const base = factor()
    if (s.startsWith('**', i)) {
      i += 2
      return base ** power()
    }
    return base
  }
  const product = (): number => {
    let v = power()
    while (isMul() || peek() === '/' || peek() === '%') {
      const op = s[i++]
      const r = power()
      v = op === '*' ? v * r : op === '/' ? v / r : v % r
    }
    return v
  }
  const sum = (): number => {
    let v = product()
    while (peek() === '+' || peek() === '-') v = s[i++] === '+' ? v + product() : v - product()
    return v
  }

  const result = sum()
  if (i < s.length) throw new Error(`Unexpected "${s[i]}"`)
  return result
}

// Units convert via a base unit per dimension (m, g, l, s); temperature is handled separately.
const UNITS: Record<string, { dim: string; factor: number }> = {
  mm: { dim: 'length', factor: 0.001 },
  cm: { dim: 'length', factor: 0.01 },
  m: { dim: 'length', factor: 1 },
  km: { dim: 'length', factor: 1000 },
  in: { dim: 'length', factor: 0.0254 },
  ft: { dim: 'length', factor: 0.3048 },
  yd: { dim: 'length', factor: 0.9144 },
  mi: { dim: 'length', factor: 1609.344 },
  mg: { dim: 'mass', factor: 0.001 },
  g: { dim: 'mass', factor: 1 },
  kg: { dim: 'mass', factor: 1000 },
  oz: { dim: 'mass', factor: 28.3495 },
  lb: { dim: 'mass', factor: 453.592 },
  ml: { dim: 'volume', factor: 0.001 },
  l: { dim: 'volume', factor: 1 },
  gal: { dim: 'volume', factor: 3.78541 },
  cup: { dim: 'volume', factor: 0.236588 },
  s: { dim: 'time', factor: 1 },
  min: { dim: 'time', factor: 60 },
  h: { dim: 'time', factor: 3600 },
  day: { dim: 'time', factor: 86400 },
}

const ALIASES: Record<string, string> = {
  millimeter: 'mm', centimeter: 'cm', meter: 'm', metre: 'm', kilometer: 'km', kilometre: 'km',
  inch: 'in', inche: 'in', foot: 'ft', feet: 'ft', yard: 'yd', mile: 'mi',
  milligram: 'mg', gram: 'g', kilogram: 'kg', kilo: 'kg', ounce: 'oz', pound: 'lb', lb: 'lb',
  milliliter: 'ml', millilitre: 'ml', liter: 'l', litre: 'l', gallon: 'gal',
  second: 's', sec: 's', minute: 'min', hour: 'h', hr: 'h',
  celsius: 'c', fahrenheit: 'f', kelvin: 'k',
}

function unitKey(u: string): string {
  const k = u.toLowerCase().replace(/[°\s.]/g, '')
  if (k in UNITS) return k
  return ALIASES[k] ?? ALIASES[k.replace(/s$/, '')] ?? k
}

export function convertUnits(value: number, from: string, to: string): string {
  const f = unitKey(from)
  const t = unitKey(to)
  const temps = ['c', 'f', 'k']
  if (temps.includes(f) && temps.includes(t)) {
    const c = f === 'c' ? value : f === 'f' ? ((value - 32) * 5) / 9 : value - 273.15
    const out = t === 'c' ? c : t === 'f' ? (c * 9) / 5 + 32 : c + 273.15
    return `${value} ${f.toUpperCase()} = ${+out.toFixed(2)} ${t.toUpperCase()}`
  }
  const a = UNITS[f]
  const b = UNITS[t]
  if (!a || !b) return `Unknown unit: ${!a ? from : to}`
  if (a.dim !== b.dim) return `Cannot convert ${a.dim} to ${b.dim}.`
  return `${value} ${f} = ${+((value * a.factor) / b.factor).toPrecision(8)} ${t}`
}

function parseDate(s: string): Date | null {
  const v = s.trim().toLowerCase()
  const d = v === '' || v === 'today' || v === 'now' ? new Date() : new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

export const utilityTools: Tool[] = [
  {
    name: 'calculator',
    category: 'Math & utility',
    description: 'Evaluate an arithmetic expression, e.g. "12 * (3 + 4)". Use for any maths or percentages.',
    keywords: 'math calculate compute plus minus times divide percent percentage sum total multiply',
    trigger: /\d\s*%|(?<![\d.])\d+\s*[-+*/^x×÷]\s*\d|percent/i,
    parameters: { expr: { type: 'string', description: 'Arithmetic expression using + - * / % ^ and parentheses, e.g. 0.15*48000' } },
    match: (m) => {
      const expr = m.match(/[\d(][\d\s+\-*/%^().xX]*[\d)]/)?.[0]
      if (expr && /^\d+(-\d+){2,}$/.test(expr)) return null // "3-2-1" or "2026-10-15" is a name or a date, not subtraction
      return expr && /[+\-*/%^xX]/.test(expr) ? { expr } : null
    },
    run: ({ expr }) => {
      try {
        return String(+calculate(expr).toPrecision(12))
      } catch (e) {
        return `Error: ${(e as Error).message}`
      }
    },
  },
  {
    name: 'current_time',
    category: 'Math & utility',
    description: 'Get the current date and time, optionally in a given time zone.',
    keywords: 'time clock date today now timezone hour what time',
    parameters: { timezone: { type: 'string', description: 'IANA zone like Asia/Manila or America/New_York; empty for local', optional: true } },
    match: (m) => (/\b(what time|current time|today.?s date|what.*date|time now|time is it)\b/i.test(m) ? {} : null),
    run: ({ timezone }) => {
      try {
        return new Date().toLocaleString('en-US', {
          dateStyle: 'full',
          timeStyle: 'long',
          ...(timezone ? { timeZone: timezone } : {}),
        })
      } catch {
        return `Unknown time zone: ${timezone}`
      }
    },
  },
  {
    name: 'date_calc',
    category: 'Math & utility',
    description: 'Date arithmetic: days between two dates, or the date N days after a start date.',
    keywords: 'date days between difference until deadline countdown add weeks weekday calendar how many days',
    parameters: {
      start: { type: 'string', description: 'Start date YYYY-MM-DD, or "today"' },
      end: { type: 'string', description: 'End date YYYY-MM-DD, to count days between', optional: true },
      days: { type: 'string', description: 'Days to add to start (negative to subtract)', optional: true },
    },
    run: ({ start, end, days }) => {
      const a = parseDate(start ?? 'today')
      if (!a) return `Could not read start date: ${start}`
      if (end) {
        const b = parseDate(end)
        if (!b) return `Could not read end date: ${end}`
        const diff = Math.round((b.getTime() - a.getTime()) / 86400000)
        return `${Math.abs(diff)} days (${(Math.abs(diff) / 7).toFixed(1)} weeks) ${diff >= 0 ? 'from' : 'before'} ${fmtDate(a)} to ${fmtDate(b)}.`
      }
      const n = Number(days)
      if (!Number.isFinite(n)) return 'Provide either an end date or a number of days.'
      return fmtDate(new Date(a.getTime() + n * 86400000))
    },
  },
  {
    name: 'unit_convert',
    category: 'Math & utility',
    description: 'Convert between units of length, mass, volume, time and temperature (e.g. km to miles, kg to lb, C to F).',
    keywords: 'convert conversion unit kilometers miles kilograms pounds celsius fahrenheit liters gallons feet inches meters',
    parameters: {
      value: { type: 'string', description: 'Number to convert' },
      from: { type: 'string', description: 'Unit to convert from, e.g. km' },
      to: { type: 'string', description: 'Unit to convert to, e.g. mi' },
    },
    run: ({ value, from, to }) => {
      const n = Number(value)
      return Number.isFinite(n) ? convertUnits(n, from, to) : `Not a number: ${value}`
    },
  },
  {
    name: 'random_number',
    category: 'Math & utility',
    description: 'Pick a random whole number in a range. Use min 1 and max 6 to roll a die; use 1 and 2 for a coin flip.',
    keywords: 'random dice roll die coin flip pick lottery number between',
    parameters: {
      min: { type: 'string', description: 'Lowest value', optional: true },
      max: { type: 'string', description: 'Highest value', optional: true },
    },
    run: ({ min = '1', max = '100' }) => {
      const lo = Math.ceil(Number(min))
      const hi = Math.floor(Number(max))
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return 'Invalid range.'
      return String(lo + Math.floor(Math.random() * (hi - lo + 1)))
    },
  },
  {
    name: 'generate_id',
    category: 'Math & utility',
    description: 'Generate a UUID or a strong random password.',
    keywords: 'uuid guid unique id password generate secure random string token',
    parameters: {
      kind: { type: 'string', description: '"uuid" or "password"' },
      length: { type: 'string', description: 'Password length (default 16)', optional: true },
    },
    run: ({ kind = 'uuid', length }) => {
      if (!/pass/i.test(kind)) return crypto.randomUUID()
      const n = Math.min(Math.max(parseInt(length ?? '16', 10) || 16, 8), 64)
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?'
      const bytes = crypto.getRandomValues(new Uint32Array(n))
      return Array.from(bytes, (b) => chars[b % chars.length]).join('')
    },
  },
]

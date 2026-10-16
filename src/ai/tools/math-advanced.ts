import type { Tool } from '../tool-types'
import { num, ok, rows } from './helpers'
import { compile } from './mathexpr'

const fmt = (n: number) => String(+n.toPrecision(10))

/** A number or a constant expression such as "pi/2" or "2e3"; NaN when it is neither. */
function value(s: string | undefined): number {
  try {
    return s?.trim() ? compile(s)({}) : NaN
  } catch {
    return NaN
  }
}

/** Parse "x=3, y=2" into { x: 3, y: 2 }. Returns null when a value is not a number. */
function parseVars(s: string | undefined): Record<string, number> | null {
  const out: Record<string, number> = {}
  for (const part of (s ?? '').split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean)) {
    const m = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(part)
    if (!m) return null
    const v = num(m[2])
    if (!Number.isFinite(v)) return null
    out[m[1].toLowerCase()] = v
  }
  return out
}

/** Parse "1,2;3,4" (rows split by ; or new lines) into a matrix. */
function parseMatrix(s: string | undefined): number[][] | null {
  const m = rows(s).map((r) => r.replace(/[[\]]/g, '').split(/[,\s]+/).filter(Boolean).map(num))
  if (!m.length || m.some((r) => !r.length || r.length !== m[0].length || r.some((v) => !Number.isFinite(v)))) return null
  return m
}

const show = (m: number[][]) => m.map((r) => r.map((v) => fmt(v)).join(', ')).join('\n')

/** Gauss-Jordan elimination on [A | B]. Returns the reduced right-hand side, the determinant and the rank. */
function gauss(a: number[][], b: number[][]) {
  const n = a.length
  const m = a.map((r, i) => [...r, ...b[i]])
  let det = 1
  let rank = 0
  for (let c = 0, r = 0; c < a[0].length && r < n; c++) {
    let p = r
    for (let i = r + 1; i < n; i++) if (Math.abs(m[i][c]) > Math.abs(m[p][c])) p = i
    if (Math.abs(m[p][c]) < 1e-12) {
      det = 0
      continue
    }
    if (p !== r) {
      ;[m[p], m[r]] = [m[r], m[p]]
      det = -det
    }
    det *= m[r][c]
    const pivot = m[r][c]
    m[r] = m[r].map((v) => v / pivot)
    for (let i = 0; i < n; i++) {
      if (i === r) continue
      const f = m[i][c]
      if (f) m[i] = m[i].map((v, j) => v - f * m[r][j])
    }
    r++
    rank++
  }
  return { rhs: m.map((r) => r.slice(a[0].length)), det, rank }
}

/** Adaptive Simpson integration. */
function integrate(f: (x: number) => number, a: number, b: number): number {
  const simpson = (fa: number, fm: number, fb: number, lo: number, hi: number) => ((hi - lo) / 6) * (fa + 4 * fm + fb)
  const go = (lo: number, hi: number, fa: number, fm: number, fb: number, whole: number, eps: number, depth: number): number => {
    const mid = (lo + hi) / 2
    const lm = (lo + mid) / 2
    const rm = (mid + hi) / 2
    const flm = f(lm)
    const frm = f(rm)
    const left = simpson(fa, flm, fm, lo, mid)
    const right = simpson(fm, frm, fb, mid, hi)
    if (depth <= 0 || Math.abs(left + right - whole) <= 15 * eps) return left + right + (left + right - whole) / 15
    return go(lo, mid, fa, flm, fm, left, eps / 2, depth - 1) + go(mid, hi, fm, frm, fb, right, eps / 2, depth - 1)
  }
  const fa = f(a)
  const fb = f(b)
  const fm = f((a + b) / 2)
  return go(a, b, fa, fm, fb, simpson(fa, fm, fb, a, b), 1e-9, 24)
}

export const mathAdvancedTools: Tool[] = [
  {
    name: 'formula_eval',
    category: 'Statistics & math',
    description: 'Evaluate a formula with named variables (physics, finance or geometry formulas). Supports functions like sqrt, sin, log, exp.',
    keywords: 'formula evaluate variables substitute plug in physics equation expression value of x y compute with values',
    parameters: {
      formula: { type: 'string', description: 'Formula using variable names, e.g. "0.5*m*v^2"' },
      variables: { type: 'string', description: 'Values as name=value pairs, e.g. "m=10, v=3"' },
    },
    run: ({ formula, variables }) => {
      const vars = parseVars(variables)
      if (!vars) return 'Write variables as name=value pairs separated by commas, e.g. "x=3, y=2".'
      try {
        return `${formula} = ${fmt(compile(formula)(vars))}`
      } catch (e) {
        return `Error: ${(e as Error).message}`
      }
    },
  },
  {
    name: 'solve_equation',
    category: 'Statistics & math',
    description: 'Find the numeric solutions (roots) of an equation in one variable, such as a polynomial or one using sin, log or exp. Searches a range for every solution.',
    keywords: 'solve equation roots solution find x zero polynomial cubic quartic algebra intersect numerically where does equal',
    parameters: {
      equation: { type: 'string', description: 'Equation such as "x^2 - 4 = 0" or just an expression (taken to equal 0)' },
      variable: { type: 'string', description: 'Variable to solve for (default x)', optional: true },
      from: { type: 'string', description: 'Start of the search range (default -100)', optional: true },
      to: { type: 'string', description: 'End of the search range (default 100)', optional: true },
    },
    run: ({ equation, variable, from, to }) => {
      const name = (variable?.trim() || 'x').toLowerCase()
      const lo = from?.trim() ? value(from) : -100
      const hi = to?.trim() ? value(to) : 100
      if (!ok(lo, hi) || lo >= hi) return 'The search range must have from < to.'
      const [l, r] = equation.split('=')
      let f: (x: number) => number
      try {
        const left = compile(l)
        const right = r?.trim() ? compile(r) : () => 0
        f = (x) => left({ [name]: x }) - right({ [name]: x })
        f(lo)
      } catch (e) {
        return `Error: ${(e as Error).message}`
      }
      const roots: number[] = []
      const steps = 4000
      const h = (hi - lo) / steps
      let prevX = lo
      let prev = f(lo)
      for (let i = 1; i <= steps; i++) {
        const x = lo + i * h
        const y = f(x)
        if (Number.isFinite(prev) && Number.isFinite(y)) {
          if (prev === 0) roots.push(prevX)
          else if (prev * y < 0) {
            let a = prevX
            let b = x
            for (let k = 0; k < 80; k++) {
              const m = (a + b) / 2
              if (f(a) * f(m) <= 0) b = m
              else a = m
            }
            const root = (a + b) / 2
            // A sign change at a pole (like 1/x at 0) is not a root.
            if (Math.abs(f(root)) < 1e-6 * Math.max(1, Math.abs(prev), Math.abs(y))) roots.push(root)
          }
        }
        prevX = x
        prev = y
      }
      const unique = roots.filter((v, i) => roots.findIndex((w) => Math.abs(w - v) < 1e-7) === i).slice(0, 12)
      return unique.length
        ? `Solutions for ${name} in [${lo}, ${hi}]: ${unique.map((v) => `${name} ≈ ${fmt(Math.abs(v) < 1e-10 ? 0 : v)}`).join('; ')}`
        : `No solutions found for ${name} in [${lo}, ${hi}] (touching roots such as x^2 = 0 can be missed: try widening or shifting the range).`
    },
  },
  {
    name: 'derivative',
    category: 'Statistics & math',
    description: 'Numerical derivative (slope) of a function at a point; first or second derivative.',
    keywords: 'derivative differentiate calculus slope rate of change tangent gradient d/dx f prime',
    parameters: {
      expr: { type: 'string', description: 'Function of x, e.g. "x^3 + sin(x)"' },
      at: { type: 'string', description: 'The x value to evaluate at' },
      order: { type: 'string', description: '1 (default) or 2', optional: true },
      variable: { type: 'string', description: 'Variable name (default x)', optional: true },
    },
    run: ({ expr, at, order, variable }) => {
      const name = (variable?.trim() || 'x').toLowerCase()
      const a = value(at)
      if (!ok(a)) return 'Give the point to evaluate at as a number.'
      try {
        const g = compile(expr)
        const f = (x: number) => g({ [name]: x })
        const h = 1e-3 * Math.max(1, Math.abs(a))
        if (order?.trim() === '2') {
          const d2 = (-f(a + 2 * h) + 16 * f(a + h) - 30 * f(a) + 16 * f(a - h) - f(a - 2 * h)) / (12 * h * h)
          return `f''(${fmt(a)}) ≈ ${fmt(d2)}`
        }
        const d = (-f(a + 2 * h) + 8 * f(a + h) - 8 * f(a - h) + f(a - 2 * h)) / (12 * h)
        return `f'(${fmt(a)}) ≈ ${fmt(d)}  (tangent line: y = ${fmt(f(a))} + ${fmt(d)}(${name} - ${fmt(a)}))`
      } catch (e) {
        return `Error: ${(e as Error).message}`
      }
    },
  },
  {
    name: 'integral',
    category: 'Statistics & math',
    description: 'Definite integral (area under a curve) of a function between two limits, computed numerically.',
    keywords: 'integral integrate calculus area under curve antiderivative definite integral from to sum area',
    parameters: {
      expr: { type: 'string', description: 'Function of x, e.g. "x^2" or "sin(x)"' },
      from: { type: 'string', description: 'Lower limit' },
      to: { type: 'string', description: 'Upper limit' },
      variable: { type: 'string', description: 'Variable name (default x)', optional: true },
    },
    run: ({ expr, from, to, variable }) => {
      const name = (variable?.trim() || 'x').toLowerCase()
      const a = value(from)
      const b = value(to)
      if (!ok(a, b)) return 'Give numeric lower and upper limits (use pi for π, e.g. "pi").'
      try {
        const g = compile(expr)
        const v = integrate((x) => g({ [name]: x }), a, b)
        return Number.isFinite(v) ? `∫ ${expr} d${name} from ${fmt(a)} to ${fmt(b)} ≈ ${fmt(v)}` : 'The function is not finite on that interval.'
      } catch (e) {
        return `Error: ${(e as Error).message}`
      }
    },
  },
  {
    name: 'series_sum',
    category: 'Statistics & math',
    description: 'Add up (or multiply) an expression for a counter running from one whole number to another, like Σ k^2 for k = 1..10.',
    keywords: 'sum series sigma summation product pi notation arithmetic geometric sequence add up terms',
    parameters: {
      expr: { type: 'string', description: 'Expression in the counter, e.g. "k^2" or "1/2^k"' },
      from: { type: 'string', description: 'First value of the counter' },
      to: { type: 'string', description: 'Last value of the counter (at most 1,000,000 terms)' },
      variable: { type: 'string', description: 'Counter name (default k)', optional: true },
      mode: { type: 'string', description: 'sum (default) or product', optional: true },
    },
    run: ({ expr, from, to, variable, mode }) => {
      const name = (variable?.trim() || 'k').toLowerCase()
      const a = num(from)
      const b = num(to)
      if (!ok(a, b) || !Number.isInteger(a) || !Number.isInteger(b) || b < a || b - a > 1e6) return 'Give whole-number limits with from <= to (at most a million terms).'
      try {
        const g = compile(expr)
        const product = /prod/i.test(mode ?? '')
        let acc = product ? 1 : 0
        for (let k = a; k <= b; k++) acc = product ? acc * g({ [name]: k }) : acc + g({ [name]: k })
        return `${product ? '∏' : 'Σ'} ${expr} for ${name} = ${a}..${b} = ${fmt(acc)}`
      } catch (e) {
        return `Error: ${(e as Error).message}`
      }
    },
  },
  {
    name: 'matrix_op',
    category: 'Statistics & math',
    description: 'Matrix maths: determinant, inverse, transpose, rank, multiply, add, or solve a linear system A·x = b.',
    keywords: 'matrix matrices determinant inverse transpose multiply linear algebra system of equations solve simultaneous rank vector',
    parameters: {
      operation: { type: 'string', description: 'determinant, inverse, transpose, rank, multiply, add or solve' },
      a: { type: 'string', description: 'Matrix A: rows split by ; and values by commas, e.g. "1,2;3,4"' },
      b: { type: 'string', description: 'Matrix B (multiply, add) or right-hand side vector (solve), same format', optional: true },
    },
    run: ({ operation, a, b }) => {
      const A = parseMatrix(a)
      if (!A) return 'Write matrix A with rows split by ; and values by commas, e.g. "1,2;3,4" (all rows the same length).'
      const op = operation.trim().toLowerCase()
      const square = A.length === A[0].length
      if (op.startsWith('transp')) return show(A[0].map((_, c) => A.map((r) => r[c])))
      if (op.startsWith('rank')) return `Rank: ${gauss(A, A.map(() => [0])).rank}`
      if (op.startsWith('det')) {
        if (!square) return 'The determinant needs a square matrix.'
        return `Determinant: ${fmt(gauss(A, A.map(() => [0])).det)}`
      }
      if (op.startsWith('inv')) {
        if (!square) return 'The inverse needs a square matrix.'
        const identity = A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0)))
        const { rhs, det } = gauss(A, identity)
        return det === 0 ? 'The matrix is singular (determinant 0), so it has no inverse.' : show(rhs)
      }
      const B = parseMatrix(b)
      if (!B) return 'This operation needs matrix B (same format).'
      if (op.startsWith('add')) {
        if (A.length !== B.length || A[0].length !== B[0].length) return 'Matrices must be the same size to add.'
        return show(A.map((r, i) => r.map((v, j) => v + B[i][j])))
      }
      if (op.startsWith('mult')) {
        if (A[0].length !== B.length) return `Cannot multiply: A has ${A[0].length} columns but B has ${B.length} rows.`
        return show(A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0))))
      }
      if (op.startsWith('solv')) {
        if (!square) return 'Solving needs a square matrix A.'
        const col = B.length === 1 && B[0].length === A.length ? B[0].map((v) => [v]) : B
        if (col.length !== A.length || col[0].length !== 1) return `The right-hand side must have ${A.length} values.`
        const { rhs, det } = gauss(A, col)
        return det === 0 ? 'The system has no unique solution (determinant 0).' : `Solution: ${rhs.map((r, i) => `x${i + 1} = ${fmt(r[0])}`).join(', ')}`
      }
      return 'Operation must be determinant, inverse, transpose, rank, multiply, add or solve.'
    },
  },
]

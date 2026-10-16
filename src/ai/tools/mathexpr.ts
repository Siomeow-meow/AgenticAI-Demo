// Safe maths: a recursive-descent parser that compiles an expression into a function. No eval.

type Vars = Record<string, number>
type Fn = (v: Vars) => number

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2 }

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new Error('Factorial needs a whole number of 0 or more')
  if (n > 170) return Infinity
  let r = 1
  for (let i = 2; i <= n; i++) r *= i
  return r
}

/** Lanczos approximation of the gamma function (positive and negative non-integers). */
function gamma(x: number): number {
  if (Number.isInteger(x) && x > 0) return factorial(x - 1)
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x))
  const g = 7
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
  const z = x - 1
  let a = c[0]
  const t = z + g + 0.5
  for (let i = 1; i < g + 2; i++) a += c[i] / (z + i)
  return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * a
}

const FUNCTIONS: Record<string, { args: number | [number, number]; run: (...a: number[]) => number }> = {
  sqrt: { args: 1, run: Math.sqrt },
  cbrt: { args: 1, run: Math.cbrt },
  abs: { args: 1, run: Math.abs },
  sin: { args: 1, run: Math.sin },
  cos: { args: 1, run: Math.cos },
  tan: { args: 1, run: Math.tan },
  asin: { args: 1, run: Math.asin },
  acos: { args: 1, run: Math.acos },
  atan: { args: 1, run: Math.atan },
  atan2: { args: 2, run: Math.atan2 },
  sinh: { args: 1, run: Math.sinh },
  cosh: { args: 1, run: Math.cosh },
  tanh: { args: 1, run: Math.tanh },
  exp: { args: 1, run: Math.exp },
  ln: { args: 1, run: Math.log },
  log: { args: [1, 2], run: (x, base) => (base === undefined ? Math.log10(x) : Math.log(x) / Math.log(base)) },
  log10: { args: 1, run: Math.log10 },
  log2: { args: 1, run: Math.log2 },
  floor: { args: 1, run: Math.floor },
  ceil: { args: 1, run: Math.ceil },
  trunc: { args: 1, run: Math.trunc },
  sign: { args: 1, run: Math.sign },
  round: { args: [1, 2], run: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d },
  pow: { args: 2, run: Math.pow },
  mod: { args: 2, run: (a, b) => a % b },
  hypot: { args: 2, run: Math.hypot },
  min: { args: 2, run: Math.min },
  max: { args: 2, run: Math.max },
  fact: { args: 1, run: factorial },
  gamma: { args: 1, run: gamma },
  degrees: { args: 1, run: (r) => (r * 180) / Math.PI },
  radians: { args: 1, run: (d) => (d * Math.PI) / 180 },
  sind: { args: 1, run: (d) => Math.sin((d * Math.PI) / 180) },
  cosd: { args: 1, run: (d) => Math.cos((d * Math.PI) / 180) },
  tand: { args: 1, run: (d) => Math.tan((d * Math.PI) / 180) },
  ncr: { args: 2, run: (n, k) => factorial(n) / (factorial(k) * factorial(n - k)) },
  npr: { args: 2, run: (n, k) => factorial(n) / factorial(n - k) },
}

/** Turn people-style notation into plain operators. */
function normalise(expr: string): string {
  return expr
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, ' pi ')
    .replace(/√/g, ' sqrt')
    .replace(/\*\*/g, '^')
    .replace(/(?<=[\d)])\s*[xX]\s*(?=[\d(.])/g, '*') // "3x4" and "(2)x(3)" mean multiplication
    .replace(/,(?=\d{3}(\D|$))/g, '') // 1,200 -> 1200
}

type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string }

function tokenize(s: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i))
    if (num) {
      out.push({ t: 'num', v: parseFloat(num[0]) })
      i += num[0].length
      continue
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i))
    if (id) {
      out.push({ t: 'id', v: id[0].toLowerCase() })
      i += id[0].length
      continue
    }
    if ('+-*/%^!(),'.includes(ch)) {
      out.push({ t: 'op', v: ch })
      i++
      continue
    }
    throw new Error(`Unexpected "${ch}"`)
  }
  return out
}

/** Compile an expression once; call the result with variable values (such as { x: 2 }). */
export function compile(expr: string): Fn {
  const toks = tokenize(normalise(expr))
  let i = 0
  const peek = () => toks[i]
  const isOp = (v: string) => peek()?.t === 'op' && (peek() as { v: string }).v === v
  const eat = (v: string) => {
    if (!isOp(v)) throw new Error(`Expected "${v}"${peek() ? ` but found "${(peek() as { v: unknown }).v}"` : ' but the expression ended'}`)
    i++
  }

  function sum(): Fn {
    let left = product()
    while (isOp('+') || isOp('-')) {
      const plus = (toks[i++] as { v: string }).v === '+'
      const l = left
      const r = product()
      left = plus ? (v) => l(v) + r(v) : (v) => l(v) - r(v)
    }
    return left
  }

  function product(): Fn {
    let left = unary()
    for (;;) {
      if (isOp('*') || isOp('/') || isOp('%')) {
        const op = (toks[i++] as { v: string }).v
        const l = left
        const r = unary()
        left = op === '*' ? (v) => l(v) * r(v) : op === '/' ? (v) => l(v) / r(v) : (v) => l(v) % r(v)
      } else if (peek() && (peek()!.t === 'num' || peek()!.t === 'id' || isOp('('))) {
        // Implicit multiplication: 2pi, 3(4+1), 2x
        const l = left
        const r = unary()
        left = (v) => l(v) * r(v)
      } else return left
    }
  }

  function unary(): Fn {
    if (isOp('-')) {
      i++
      const f = unary()
      return (v) => -f(v)
    }
    if (isOp('+')) {
      i++
      return unary()
    }
    return power()
  }

  function power(): Fn {
    const base = postfix()
    if (isOp('^')) {
      i++
      const exp = unary() // right-associative, allows 2^-1
      return (v) => base(v) ** exp(v)
    }
    return base
  }

  function postfix(): Fn {
    let f = primary()
    while (isOp('!')) {
      i++
      const inner = f
      f = (v) => factorial(inner(v))
    }
    return f
  }

  function primary(): Fn {
    const tok = peek()
    if (!tok) throw new Error('The expression ended unexpectedly')
    if (tok.t === 'num') {
      i++
      return () => tok.v
    }
    if (tok.t === 'id') {
      i++
      const name = tok.v
      if (isOp('(')) {
        const fn = FUNCTIONS[name]
        if (!fn) throw new Error(`Unknown function "${name}"`)
        i++
        const args: Fn[] = []
        if (!isOp(')')) {
          args.push(sum())
          while (isOp(',')) {
            i++
            args.push(sum())
          }
        }
        eat(')')
        const [min, max] = Array.isArray(fn.args) ? fn.args : [fn.args, fn.args]
        if (args.length < min || args.length > max) throw new Error(`${name}() takes ${min === max ? min : `${min} or ${max}`} argument(s)`)
        return (v) => fn.run(...args.map((a) => a(v)))
      }
      if (name in CONSTANTS) return (v) => (name in v ? v[name] : CONSTANTS[name])
      return (v) => {
        if (!(name in v)) throw new Error(`Unknown name "${name}"`)
        return v[name]
      }
    }
    if (tok.v === '(') {
      i++
      const f = sum()
      eat(')')
      return f
    }
    throw new Error(`Unexpected "${tok.v}"`)
  }

  const f = sum()
  if (i < toks.length) throw new Error(`Unexpected "${(toks[i] as { v: unknown }).v}"`)
  return f
}

/** Evaluate an expression once. */
export function calculate(expr: string, vars: Vars = {}): number {
  return compile(expr)(vars)
}

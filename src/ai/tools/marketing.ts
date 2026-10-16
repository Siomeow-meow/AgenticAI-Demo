import type { Tool } from '../tool-types'
import { money, num, ok, round, rows } from './helpers'

export const marketingTools: Tool[] = [
  {
    name: 'ad_metrics',
    category: 'Marketing & sales',
    description: 'Advertising metrics (CTR, CPC, CPM, conversion rate, CPA, ROAS) from spend, impressions, clicks, conversions and revenue.',
    keywords: 'ad advertising campaign ctr cpc cpm cpa roas click through rate cost per click conversion marketing spend impressions facebook google ads',
    parameters: {
      spend: { type: 'string', description: 'Total ad spend' },
      impressions: { type: 'string', description: 'Number of impressions', optional: true },
      clicks: { type: 'string', description: 'Number of clicks', optional: true },
      conversions: { type: 'string', description: 'Number of conversions (sales or sign-ups)', optional: true },
      revenue: { type: 'string', description: 'Revenue from the campaign', optional: true },
    },
    run: (a) => {
      const spend = num(a.spend), imp = num(a.impressions), clk = num(a.clicks), conv = num(a.conversions), rev = num(a.revenue)
      if (!ok(spend) || spend < 0) return 'Give the ad spend as a number.'
      const out: string[] = []
      if (ok(imp, clk) && imp > 0) out.push(`CTR: ${round((clk / imp) * 100, 2)}%`)
      if (ok(clk) && clk > 0) out.push(`CPC: ${money(spend / clk)}`)
      if (ok(imp) && imp > 0) out.push(`CPM: ${money((spend / imp) * 1000)}`)
      if (ok(conv, clk) && clk > 0) out.push(`Conversion rate: ${round((conv / clk) * 100, 2)}%`)
      if (ok(conv) && conv > 0) out.push(`CPA (cost per acquisition): ${money(spend / conv)}`)
      if (ok(rev) && spend > 0) out.push(`ROAS: ${round(rev / spend, 2)}x (profit before other costs: ${money(rev - spend)})`)
      return out.length ? out.join('\n') : 'Add impressions, clicks, conversions or revenue to get metrics.'
    },
  },
  {
    name: 'cac_ltv',
    category: 'Marketing & sales',
    description: 'Customer acquisition cost, customer lifetime value, the LTV:CAC ratio and the months to pay back acquisition.',
    keywords: 'cac ltv lifetime value customer acquisition cost payback churn retention subscription saas unit economics arpu',
    parameters: {
      marketing_spend: { type: 'string', description: 'Sales and marketing spend in the period' },
      new_customers: { type: 'string', description: 'New customers won in the period' },
      monthly_revenue_per_customer: { type: 'string', description: 'Average revenue per customer per month' },
      gross_margin_pct: { type: 'string', description: 'Gross margin in percent (default 100)', optional: true },
      monthly_churn_pct: { type: 'string', description: 'Customers lost per month, in percent' },
    },
    run: (a) => {
      const spend = num(a.marketing_spend), n = num(a.new_customers), arpu = num(a.monthly_revenue_per_customer)
      const gm = a.gross_margin_pct?.trim() ? num(a.gross_margin_pct) : 100
      const churn = num(a.monthly_churn_pct)
      if (!ok(spend, n, arpu, gm, churn) || n <= 0 || churn <= 0) return 'I need spend, new customers (above 0), revenue per customer and monthly churn (above 0).'
      const cac = spend / n
      const monthlyProfit = arpu * (gm / 100)
      const ltv = monthlyProfit / (churn / 100)
      const ratio = ltv / cac
      return [
        `CAC: ${money(cac)}`,
        `Customer lifetime: ${round(100 / churn, 1)} months`,
        `LTV: ${money(ltv)}`,
        `LTV:CAC = ${round(ratio, 2)} (${ratio >= 3 ? 'healthy, 3 or more' : ratio >= 1 ? 'thin, aim for 3 or more' : 'losing money on each customer'})`,
        `CAC payback: ${round(cac / monthlyProfit, 1)} months`,
      ].join('\n')
    },
  },
  {
    name: 'funnel_analysis',
    category: 'Marketing & sales',
    description: 'Conversion rate between each stage of a sales or marketing funnel and where most people drop off.',
    keywords: 'funnel conversion stages drop off leads prospects pipeline visitors signups sales funnel bottleneck',
    parameters: { stages: { type: 'string', description: 'Stage:count pairs in order, like "Visitors:10000; Leads:800; Demos:200; Customers:40"' } },
    run: ({ stages }) => {
      const s = rows(stages).map((l) => {
        const i = l.lastIndexOf(':')
        return [l.slice(0, i).trim(), num(l.slice(i + 1))] as const
      })
      if (s.length < 2 || s.some(([, c]) => !ok(c))) return 'Write stages as Name:count pairs separated by ;, at least two.'
      let worst = { name: '', rate: 101 }
      const lines = s.slice(1).map(([name, c], i) => {
        const rate = s[i][1] > 0 ? (c / s[i][1]) * 100 : 0
        if (rate < worst.rate) worst = { name: `${s[i][0]} → ${name}`, rate }
        return `${s[i][0]} → ${name}: ${round(rate, 1)}%`
      })
      const overall = s[0][1] > 0 ? (s[s.length - 1][1] / s[0][1]) * 100 : 0
      return `${lines.join('\n')}\nOverall: ${round(overall, 2)}%\nBiggest drop-off: ${worst.name} (${round(worst.rate, 1)}%)`
    },
  },
  {
    name: 'quota_attainment',
    category: 'Marketing & sales',
    description: 'Sales quota attainment, the gap to quota, and pipeline coverage needed to close it.',
    keywords: 'sales quota attainment target pipeline coverage win rate close rate gap rep forecast',
    parameters: {
      quota: { type: 'string', description: 'Sales target for the period' },
      closed: { type: 'string', description: 'Closed-won amount so far' },
      pipeline: { type: 'string', description: 'Open pipeline value', optional: true },
      win_rate_pct: { type: 'string', description: 'Typical win rate in percent', optional: true },
    },
    run: (a) => {
      const quota = num(a.quota), closed = num(a.closed), pipe = num(a.pipeline), win = num(a.win_rate_pct)
      if (!ok(quota, closed) || quota <= 0) return 'Give the quota (above 0) and the amount closed so far.'
      const gap = Math.max(quota - closed, 0)
      let out = `Attainment: ${round((closed / quota) * 100, 1)}%. Gap to quota: ${money(gap)}.`
      if (ok(win) && win > 0 && gap > 0) {
        const need = gap / (win / 100)
        out += ` At a ${win}% win rate you need ${money(need)} of pipeline`
        out += ok(pipe) ? `; you have ${money(pipe)} (${pipe >= need ? 'enough' : `short by ${money(need - pipe)}`}).` : '.'
      } else if (ok(pipe) && gap > 0) out += ` Pipeline coverage: ${round(pipe / gap, 2)}x the gap (3x is a common target).`
      return out
    },
  },
]

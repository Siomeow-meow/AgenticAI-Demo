import type { Tool } from '../tool-types'
import { dateOf, isoDay, money, num, ok, round, rows } from './helpers'

const isWorkday = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6

/** Move to the next Monday-to-Friday day. */
function nextWorkday(d: Date) {
  do d.setUTCDate(d.getUTCDate() + 1)
  while (!isWorkday(d))
}

export const projectTools: Tool[] = [
  {
    name: 'earned_value',
    category: 'Project management',
    description: 'Earned value analysis: schedule and cost variance, SPI, CPI and the estimate at completion.',
    keywords: 'earned value evm project budget schedule variance spi cpi eac planned value actual cost over budget behind schedule pmp',
    parameters: {
      budget_at_completion: { type: 'string', description: 'Total project budget (BAC)' },
      planned_pct: { type: 'string', description: 'Percent of work that should be done by now' },
      complete_pct: { type: 'string', description: 'Percent of work actually done' },
      actual_cost: { type: 'string', description: 'Money spent so far' },
    },
    run: (a) => {
      const bac = num(a.budget_at_completion), pv = (num(a.planned_pct) / 100) * bac, ev = (num(a.complete_pct) / 100) * bac, ac = num(a.actual_cost)
      if (!ok(bac, pv, ev, ac) || bac <= 0 || ac <= 0 || pv <= 0 || ev <= 0) return 'I need the budget, planned %, completed % and actual cost (all above 0).'
      const spi = ev / pv, cpi = ev / ac, eac = bac / cpi
      return [
        `PV ${money(pv)}, EV ${money(ev)}, AC ${money(ac)}`,
        `Schedule variance: ${money(ev - pv)}, SPI ${round(spi, 2)} (${spi < 1 ? 'behind schedule' : 'on or ahead of schedule'})`,
        `Cost variance: ${money(ev - ac)}, CPI ${round(cpi, 2)} (${cpi < 1 ? 'over budget' : 'on or under budget'})`,
        `Estimate at completion: ${money(eac)} (${eac > bac ? 'over' : 'under'} budget by ${money(Math.abs(eac - bac))})`,
      ].join('\n')
    },
  },
  {
    name: 'velocity_forecast',
    category: 'Project management',
    description: 'Forecast how many sprints and weeks a backlog will take from past sprint velocities.',
    keywords: 'agile scrum sprint velocity backlog story points forecast burn down how many sprints release date team capacity',
    parameters: {
      past_velocities: { type: 'string', description: 'Story points done in recent sprints, like "21, 18, 24, 20"' },
      backlog_points: { type: 'string', description: 'Story points remaining' },
      sprint_weeks: { type: 'string', description: 'Weeks per sprint (default 2)', optional: true },
    },
    run: (a) => {
      const v = (a.past_velocities ?? '').split(/[,;\s]+/).filter(Boolean).map(num)
      const backlog = num(a.backlog_points), wk = a.sprint_weeks?.trim() ? num(a.sprint_weeks) : 2
      if (!v.length || !ok(...v, backlog, wk) || backlog < 0 || wk <= 0 || Math.min(...v) <= 0) return 'Give past velocities (above 0) and the remaining backlog points.'
      const avg = v.reduce((x, y) => x + y, 0) / v.length
      const lo = Math.min(...v), hi = Math.max(...v)
      const sprints = (pts: number) => Math.ceil(backlog / pts)
      return `Average velocity ${round(avg, 1)} points/sprint (range ${lo}–${hi}).\nLikely: ${sprints(avg)} sprints (${sprints(avg) * wk} weeks). Best case: ${sprints(hi)} sprints. Worst case: ${sprints(lo)} sprints (${sprints(lo) * wk} weeks).`
    },
  },
  {
    name: 'risk_matrix',
    category: 'Project management',
    description: 'Score and rank project risks by probability times impact (1 to 5 each) and label them low, medium or high.',
    keywords: 'risk register risk matrix probability impact score rank prioritize project risks mitigation severity likelihood',
    parameters: { risks: { type: 'string', description: 'Risks as Name:probability:impact (1-5), like "Vendor delay:4:3; Key person leaves:2:5"' } },
    run: ({ risks }) => {
      const list = rows(risks).map((l) => {
        const p = l.split(':')
        return { name: p[0]?.trim(), prob: num(p[1]), impact: num(p[2]) }
      })
      if (!list.length || list.some((r) => !r.name || !ok(r.prob, r.impact) || r.prob < 1 || r.prob > 5 || r.impact < 1 || r.impact > 5))
        return 'Write risks as Name:probability:impact with both from 1 to 5, separated by ;.'
      return list
        .map((r) => ({ ...r, score: r.prob * r.impact }))
        .sort((x, y) => y.score - x.score)
        .map((r) => `${r.name}: ${r.score} (${r.score >= 15 ? 'HIGH' : r.score >= 8 ? 'MEDIUM' : 'LOW'})`)
        .join('\n')
    },
  },
  {
    name: 'project_timeline',
    category: 'Project management',
    description: 'Lay tasks end to end from a start date, skipping weekends, and give each task start and finish dates.',
    keywords: 'project timeline schedule gantt tasks duration start date finish date deadline sequential plan milestones working days',
    parameters: {
      start: { type: 'string', description: 'Start date YYYY-MM-DD (default today)', optional: true },
      tasks: { type: 'string', description: 'Task:working days pairs, like "Design:5; Build:10; Test:4"' },
    },
    run: ({ start, tasks }) => {
      const d = dateOf(start)
      const list = rows(tasks).map((l) => {
        const i = l.lastIndexOf(':')
        return { name: l.slice(0, i).trim(), days: num(l.slice(i + 1)) }
      })
      if (!d || !list.length || list.some((t) => !t.name || !ok(t.days) || t.days < 1)) return 'Give a start date and tasks as Name:days pairs separated by ;.'
      const cur = new Date(d)
      if (!isWorkday(cur)) nextWorkday(cur)
      const lines = list.map((t) => {
        const s = isoDay(cur)
        for (let n = 1; n < t.days; n++) nextWorkday(cur)
        const f = isoDay(cur)
        nextWorkday(cur)
        return `${t.name}: ${s} → ${f} (${t.days} working days)`
      })
      return `${lines.join('\n')}\nTotal: ${list.reduce((x, t) => x + t.days, 0)} working days (weekends skipped, holidays not).`
    },
  },
]

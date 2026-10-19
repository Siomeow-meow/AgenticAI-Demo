import { addTicket, employeeStore, inventoryStore, salesStore, ticketStore } from '../data'
import type { Ticket } from '../data'
import type { Tool } from '../tool-types'
import { fuzzyFind, searchAllData } from './fuzzy'

const peso = (n: number) => `₱${n.toLocaleString()}`

export const companyTools: Tool[] = [
  {
    name: 'lookup_employee',
    category: 'Company data',
    description: 'Look up an employee by name, role or department. Returns role, email and remaining leave days.',
    keywords: 'employee staff person who is contact email phone department team manager leave balance directory',
    dynamicKeywords: () => employeeStore.get().slice(0, 5000).map((e) => `${e.name} ${e.role} ${e.department}`).join(' '),
    parameters: { query: { type: 'string', description: 'Name, role or department, e.g. "Maria" or "Finance"' } },
    run: ({ query }) => {
      const found = fuzzyFind(employeeStore.get(), query, (e) => `${e.name} ${e.role} ${e.department}`)
      if (!found.length) {
        // The person may be in an imported "other table" (e.g. people.csv) rather than the Employees list.
        const lines = searchAllData(query)
        return lines.length ? `Not in the employee list, but found in imported tables:\n${lines.join('\n')}` : 'No matching employee found.'
      }
      return found
        .map((e) => `${e.name} - ${e.role}, ${e.department}. Email: ${e.email}. Leave days left: ${e.leaveDays}.`)
        .join('\n')
    },
  },
  {
    name: 'check_inventory',
    category: 'Company data',
    description: 'Check stock levels by item name or SKU. Leave the query empty to list items below their reorder level.',
    keywords: 'stock inventory sku warehouse items quantity reorder low supply',
    dynamicKeywords: () => inventoryStore.get().slice(0, 5000).map((i) => `${i.name} ${i.sku}`).join(' '),
    parameters: { query: { type: 'string', description: 'Item name or SKU; empty for low-stock items', optional: true } },
    run: ({ query = '' }) => {
      const inventory = inventoryStore.get()
      const items = query.trim()
        ? fuzzyFind(inventory, query, (i) => `${i.name} ${i.sku}`, 4)
        : inventory.filter((i) => i.qty < i.reorderLevel)
      if (!items.length) return 'No matching items.'
      return items
        .map(
          (i) =>
            `${[i.sku, i.name].filter(Boolean).join(' ')}: ${i.qty} in stock${i.location ? ` at ${i.location}` : ''}${i.reorderLevel ? ` (reorder level ${i.reorderLevel})` : ''}${i.qty < i.reorderLevel ? ' - LOW STOCK' : ''}`,
        )
        .join('\n')
    },
  },
  {
    name: 'sales_summary',
    category: 'Company data',
    description: 'Summarise sales revenue and order counts from the sales data, optionally for one region.',
    keywords: 'sales revenue orders region quarter income performance report',
    dynamicKeywords: () => [...new Set(salesStore.get().map((s) => `${s.region} ${s.month}`))].join(' '),
    parameters: { region: { type: 'string', description: 'Region name; empty for all regions', optional: true } },
    run: ({ region = '' }) => {
      const r = region.trim().toLowerCase()
      const sales = salesStore.get()
      const rows = r ? sales.filter((s) => s.region.toLowerCase() === r) : sales
      if (!rows.length) return `No sales data for region "${region}".`
      const total = rows.reduce((a, s) => a + s.revenue, 0)
      const orders = rows.reduce((a, s) => a + s.orders, 0)
      const byRegion = new Map<string, number>()
      for (const s of rows) byRegion.set(s.region, (byRegion.get(s.region) ?? 0) + s.revenue)
      const lines = [...byRegion].map(([k, v]) => `${k}: ${peso(v)}`).join(', ')
      const months = [...new Set(rows.map((s) => s.month).filter(Boolean))]
      const period = months.length > 1 ? `${months[0]} to ${months[months.length - 1]}` : (months[0] ?? 'All data')
      return `${period}${r ? ` (${region})` : ''}: revenue ${peso(total)} from ${orders} orders. By region: ${lines}.`
    },
  },
  {
    name: 'create_ticket',
    category: 'Company data',
    description: 'Create an IT/support ticket. Use when the user asks to report a problem or open a ticket.',
    keywords: 'ticket create raise report problem issue broken help support bug incident open',
    parameters: {
      title: { type: 'string', description: 'Short description of the problem' },
      priority: { type: 'string', description: 'low, medium or high', optional: true },
    },
    run: ({ title, priority = 'medium' }) => {
      const p: Ticket['priority'] = priority === 'high' || priority === 'low' ? priority : 'medium'
      const t = addTicket(title, p)
      return `Created ticket ${t.id} (${t.priority} priority): ${t.title}`
    },
  },
  {
    name: 'list_tickets',
    category: 'Company data',
    description: 'List all support tickets created so far.',
    keywords: 'tickets list show my open all support issues status',
    parameters: {},
    run: () => {
      const all = ticketStore.get()
      return all.length ? all.map((t) => `${t.id} [${t.priority}] ${t.title} (${t.createdAt})`).join('\n') : 'No tickets yet.'
    },
  },
]

import { createStore } from './store'

// Sample company data used by the tools. Replace with real API calls in production.

export interface Employee {
  name: string
  role: string
  department: string
  email: string
  leaveDays: number
}

export const employees: Employee[] = [
  { name: 'Maria Santos', role: 'HR Manager', department: 'Human Resources', email: 'maria.santos@acme.example', leaveDays: 12 },
  { name: 'John Reyes', role: 'Software Engineer', department: 'Engineering', email: 'john.reyes@acme.example', leaveDays: 8 },
  { name: 'Anna Cruz', role: 'Finance Analyst', department: 'Finance', email: 'anna.cruz@acme.example', leaveDays: 15 },
  { name: 'Paolo Garcia', role: 'Warehouse Manager', department: 'Operations', email: 'paolo.garcia@acme.example', leaveDays: 5 },
  { name: 'Lea Mendoza', role: 'Sales Lead', department: 'Sales', email: 'lea.mendoza@acme.example', leaveDays: 10 },
  { name: 'Carlo Bautista', role: 'IT Support Specialist', department: 'IT', email: 'carlo.bautista@acme.example', leaveDays: 9 },
]

export interface StockItem {
  sku: string
  name: string
  qty: number
  reorderLevel: number
  location: string
}

export const inventory: StockItem[] = [
  { sku: 'SKU-1001', name: 'Laptop 14 inch', qty: 42, reorderLevel: 15, location: 'Warehouse A' },
  { sku: 'SKU-1002', name: 'Monitor 27 inch', qty: 9, reorderLevel: 12, location: 'Warehouse A' },
  { sku: 'SKU-1003', name: 'Wireless Keyboard', qty: 120, reorderLevel: 40, location: 'Warehouse B' },
  { sku: 'SKU-1004', name: 'USB-C Dock', qty: 6, reorderLevel: 10, location: 'Warehouse B' },
  { sku: 'SKU-1005', name: 'Office Chair', qty: 33, reorderLevel: 10, location: 'Warehouse C' },
  { sku: 'SKU-1006', name: 'Printer Toner', qty: 18, reorderLevel: 20, location: 'Warehouse C' },
]

export interface SaleRow {
  month: string
  region: string
  revenue: number
  orders: number
}

export const sales: SaleRow[] = [
  { month: 'Jul 2026', region: 'North', revenue: 410000, orders: 130 },
  { month: 'Jul 2026', region: 'South', revenue: 295000, orders: 98 },
  { month: 'Jul 2026', region: 'West', revenue: 350000, orders: 112 },
  { month: 'Aug 2026', region: 'North', revenue: 445000, orders: 141 },
  { month: 'Aug 2026', region: 'South', revenue: 310000, orders: 101 },
  { month: 'Aug 2026', region: 'West', revenue: 372000, orders: 119 },
  { month: 'Sep 2026', region: 'North', revenue: 480000, orders: 152 },
  { month: 'Sep 2026', region: 'South', revenue: 288000, orders: 95 },
  { month: 'Sep 2026', region: 'West', revenue: 395000, orders: 127 },
]

// --- Live company data: start as the samples above, replaced when you import your own files ---

export const employeeStore = createStore<Employee[]>('acme-data-employees', employees)
export const inventoryStore = createStore<StockItem[]>('acme-data-inventory', inventory)
export const salesStore = createStore<SaleRow[]>('acme-data-sales', sales)

/** Any other table you import (CSV or JSON), queryable by the generic dataset tools. */
export interface Dataset {
  name: string
  headers: string[]
  rows: string[][]
}
export const datasetStore = createStore<Dataset[]>('acme-data-datasets', [])

// --- User data: small persistent stores the UI and the tools share ---

export interface Ticket {
  id: string
  title: string
  priority: 'low' | 'medium' | 'high'
  createdAt: string
}

export interface Note {
  id: string
  text: string
  createdAt: string
}

export interface Task {
  id: string
  title: string
  due: string
  done: boolean
  assignee?: string
}

export const ticketStore = createStore<Ticket[]>('acme-assistant-tickets', [])
export const noteStore = createStore<Note[]>('acme-assistant-notes', [])
export const taskStore = createStore<Task[]>('acme-assistant-tasks', [])

const stamp = () => new Date().toLocaleString()

export function addTicket(title: string, priority: Ticket['priority']): Ticket {
  const all = ticketStore.get()
  const ticket: Ticket = { id: `T-${1000 + all.length + 1}`, title, priority, createdAt: stamp() }
  ticketStore.set([...all, ticket])
  return ticket
}

export function addNote(text: string): Note {
  const all = noteStore.get()
  const note: Note = { id: `N-${all.length + 1}`, text, createdAt: stamp() }
  noteStore.set([...all, note])
  return note
}

export function addTask(title: string, due: string, assignee?: string): Task {
  const all = taskStore.get()
  const task: Task = { id: `K-${all.length + 1}`, title, due, done: false, ...(assignee ? { assignee } : {}) }
  taskStore.set([...all, task])
  return task
}

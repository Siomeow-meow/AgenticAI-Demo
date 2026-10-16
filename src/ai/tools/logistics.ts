import type { Tool } from '../tool-types'
import { dateOf, isoDay, money, num, ok, round } from './helpers'

const dims = (s: string | undefined) => (s ?? '').split(/[x×*,\s]+/).filter(Boolean).map(num)

/** Typical usable volume (m³) and payload (kg). */
const CONTAINERS: Record<string, [number, number]> = { '20ft': [28, 25000], '40ft': [58, 26500], '40hc': [68, 26500], pallet: [1.6, 1000] }

export const logisticsTools: Tool[] = [
  {
    name: 'dim_weight',
    category: 'Logistics & shipping',
    description: 'Volumetric (dimensional) weight of a parcel and which weight a carrier will bill, actual or volumetric.',
    keywords: 'dimensional weight volumetric weight shipping parcel package box courier freight billable chargeable fedex dhl ups',
    parameters: {
      dimensions_cm: { type: 'string', description: 'Length x width x height in cm, like "40x30x20"' },
      actual_kg: { type: 'string', description: 'Actual weight in kg' },
      divisor: { type: 'string', description: 'Carrier divisor (default 5000)', optional: true },
    },
    run: (a) => {
      const [l, w, h] = dims(a.dimensions_cm), kg = num(a.actual_kg), div = a.divisor?.trim() ? num(a.divisor) : 5000
      if (!ok(l, w, h, kg, div) || div <= 0) return 'Give dimensions like 40x30x20 (cm) and the actual weight in kg.'
      const vol = (l * w * h) / div
      return `Volumetric weight: ${round(vol, 2)} kg (divisor ${div}). Actual: ${kg} kg. Billable: ${round(Math.max(vol, kg), 2)} kg (${vol > kg ? 'volumetric' : 'actual'} weight).`
    },
  },
  {
    name: 'container_load',
    category: 'Logistics & shipping',
    description: 'How many boxes fit in a shipping container or pallet by volume and weight, and which limit is reached first.',
    keywords: 'container load pallet cbm cubic meters boxes fit 20ft 40ft shipping capacity cartons loading weight limit',
    parameters: {
      box_cm: { type: 'string', description: 'Box size L x W x H in cm, like "50x40x30"' },
      box_kg: { type: 'string', description: 'Weight of one box in kg' },
      container: { type: 'string', description: '20ft, 40ft, 40hc or pallet (default 20ft)', optional: true },
    },
    run: (a) => {
      const [l, w, h] = dims(a.box_cm), kg = num(a.box_kg)
      const key = (a.container?.trim() || '20ft').toLowerCase().replace(/[\s'"]/g, '')
      const spec = CONTAINERS[key]
      if (!spec) return 'Container must be 20ft, 40ft, 40hc or pallet.'
      if (!ok(l, w, h, kg) || l <= 0 || w <= 0 || h <= 0 || kg <= 0) return 'Give the box size like 50x40x30 (cm) and its weight in kg.'
      const byVol = Math.floor(spec[0] / ((l * w * h) / 1e6)), byKg = Math.floor(spec[1] / kg)
      return `${key}: about ${Math.min(byVol, byKg)} boxes. By volume ${byVol} (${spec[0]} m³ usable), by weight ${byKg} (${spec[1]} kg payload). Limit reached first: ${byVol <= byKg ? 'volume' : 'weight'}. Estimates ignore stacking gaps.`
    },
  },
  {
    name: 'delivery_eta',
    category: 'Logistics & shipping',
    description: 'Estimated delivery date from an order date and a number of business days (skips weekends).',
    keywords: 'delivery eta estimated arrival ship date business days lead time transit order arrives when will it arrive shipping time',
    parameters: {
      order_date: { type: 'string', description: 'Ship or order date YYYY-MM-DD (default today)', optional: true },
      business_days: { type: 'string', description: 'Business days in transit' },
    },
    run: ({ order_date, business_days }) => {
      const d = dateOf(order_date), n = num(business_days)
      if (!d || !ok(n) || n < 0) return 'Give a date (YYYY-MM-DD) and a number of business days.'
      const cur = new Date(d)
      for (let i = 0; i < n; ) {
        cur.setUTCDate(cur.getUTCDate() + 1)
        if (cur.getUTCDay() !== 0 && cur.getUTCDay() !== 6) i++
      }
      return `${isoDay(d)} + ${n} business days = ${cur.toUTCString().slice(0, 16)} (${isoDay(cur)}). Holidays are not counted.`
    },
  },
  {
    name: 'landed_cost',
    category: 'Logistics & shipping',
    description: 'Landed cost per unit of imported goods: product, freight, insurance, duty and other fees.',
    keywords: 'landed cost import duty tariff customs freight insurance brokerage cost per unit sourcing supplier total cost',
    parameters: {
      product_cost: { type: 'string', description: 'Total product cost' },
      freight: { type: 'string', description: 'Freight cost', optional: true },
      insurance: { type: 'string', description: 'Insurance cost', optional: true },
      duty_pct: { type: 'string', description: 'Import duty in percent of product + freight + insurance', optional: true },
      other_fees: { type: 'string', description: 'Brokerage, handling and other fees', optional: true },
      units: { type: 'string', description: 'Number of units' },
    },
    run: (a) => {
      const z = (s?: string) => (s?.trim() ? num(s) : 0)
      const p = num(a.product_cost), f = z(a.freight), ins = z(a.insurance), d = z(a.duty_pct), o = z(a.other_fees), u = num(a.units)
      if (!ok(p, f, ins, d, o, u) || u <= 0 || p <= 0) return 'I need the product cost and the number of units (both above 0).'
      const duty = ((p + f + ins) * d) / 100
      const total = p + f + ins + duty + o
      return `Duty: ${money(duty)}. Total landed cost: ${money(total)} for ${u} units = ${money(total / u)} per unit (${round((total / p - 1) * 100, 1)}% above product cost).`
    },
  },
]

// What the side panel is handed to draw, and the things it may ask for; register.tsx fills both.
import type { Ask, Badge, Boss, Employee, Fx, Gauge, Memory, Payroll } from '../types'

export type PanelData = {
  staff: Employee[]
  boss: Boss
  fx: Fx
  tick: number
  blurbs: Record<string, string>
  roster: Record<string, Badge>
  asks: Ask[]
  payroll: Payroll
  memory: Memory[]
  gauge: Gauge
  now: number
}

export type PanelActions = {
  setFind: (tab: 'decisions' | 'people', text: string) => unknown
  openDesk: () => unknown
  resume: (task: string) => unknown
  forget: (id: string) => unknown
  layOff: (type: string) => unknown
  hire: (type: string) => unknown
}

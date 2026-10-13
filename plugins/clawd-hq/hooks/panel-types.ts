// What the side panel is handed to draw, and the things it may ask for; register.tsx fills both.
import type { Badge, Boss, Employee, Fx, Gauge, Memory, Payroll } from '../types'

export type PanelData = {
  staff: Employee[]
  boss: Boss
  fx: Fx
  tick: number
  blurbs: Record<string, string>
  roster: Record<string, Badge>
  payroll: Payroll
  memory: Memory[]
  gauge: Gauge
  now: number
}

export type PanelActions = {
  setFind: (tab: 'decisions' | 'people', text: string) => unknown
  forget: (id: string) => unknown
  layOff: (type: string) => unknown
  hire: (type: string) => unknown
  /** The person's answer to the payroll review: lay off what the project has no use for, or keep everyone. */
  settlePayroll: (isLayoff: boolean) => unknown
}

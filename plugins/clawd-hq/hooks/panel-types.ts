// What the side panel is handed to draw, and the things it may ask for; register.tsx fills both.
import type { Artifact, Badge, Boss, ClawdBrief, Employee, Fx, Gauge, KnowState, Memory, Payroll } from '../types'
import type { ClawdActions } from './clawd-edit'
import type { KnowActions } from './know-check'

export type PanelData = {
  staff: Employee[]
  boss: Boss
  fx: Fx
  tick: number
  blurbs: Record<string, string>
  roster: Record<string, Badge>
  payroll: Payroll
  memory: Memory[]
  /** The pages Claude published or opened in this project, newest first. */
  artifacts: Artifact[]
  gauge: Gauge
  now: number
  /** The notes from the check on finished work waiting on Clawd's card. */
  know: KnowState
  /** What the Clawd tab shows: Clawd's instructions and voice notes, and the word left by its last button. */
  brief: ClawdBrief
}

export type PanelActions = KnowActions & ClawdActions & {
  setFind: (tab: 'decisions' | 'people', text: string) => unknown
  forget: (id: string) => unknown
  layOff: (type: string) => unknown
  hire: (type: string) => unknown
  /** The person's answer to the payroll review: lay off what the project has no use for, or keep everyone. */
  settlePayroll: (isLayoff: boolean) => unknown
  /** Opens the usage footer's rows, or closes them. */
  toggleUsage: () => unknown
}

// What the side panel is handed to draw, and the things it may ask for; register.tsx fills both.
import type { Artifact, Badge, Boss, ClawdBrief, Employee, Fx, Gauge, KnowState, Memory, Payroll } from '../types'
import type { ClawdActions } from './clawd-edit'
import type { ConfigField } from './configs'
import type { BriefingOptions } from './instructions'
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
  /** What the Settings tab shows of Clawd's instructions and voice notes, and the word left by its last button. */
  brief: ClawdBrief
  /** The plugin's on/off configs and voice file path as this load of the plugin got them. */
  options: BriefingOptions
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
  /** Settings shows the list of finished work (true) or its configs again (false). */
  showLog: (isOpen: boolean) => unknown
  /** A config's toggle pressed: the settings row is set to `value`; a refusal is kept as the tab's note. */
  setConfig: (field: ConfigField, value: boolean) => unknown
}

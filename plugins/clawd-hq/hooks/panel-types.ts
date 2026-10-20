// What the side panel is handed to draw, and the things it may ask for; register.tsx fills both.
import type { Artifact, Badge, Boss, ClawdBrief, Employee, Fx, Gauge, KnowState, LeftItem, Memory, Payroll } from '../types'
import type { ClawdActions } from './clawd-edit'
import type { ConfigField } from './configs'
import type { BriefPart, BriefingOptions } from './instructions'
import type { KnowActions } from './know-check'
import type { LeftActions } from './left-io'
import type { OnboardButton, OnboardCard } from './onboard-types'

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
  /** What Claude or a specialist left unfinished in this project, newest first. */
  leftUndone: LeftItem[]
  gauge: Gauge
  now: number
  /** The notes from the check on finished work waiting on Clawd's card. */
  know: KnowState
  /** What the Settings tab shows of Clawd's instructions and voice notes, and the word left by its last button. */
  brief: ClawdBrief
  /** The plugin's on/off configs and voice file path as this load of the plugin got them. */
  options: BriefingOptions
  /** The setup step drawn under Clawd's card; none, or a finished one, draws nothing. */
  onboard?: OnboardCard
}

export type PanelActions = KnowActions & ClawdActions & LeftActions & {
  setFind: (tab: 'decisions' | 'people', text: string) => unknown
  forget: (id: string) => unknown
  /** The Hide button on an artifact row: that page leaves this project's desk (not claude.ai) until it is published or opened again. */
  hideArtifact: (url: string) => unknown
  layOff: (type: string) => unknown
  hire: (type: string) => unknown
  /** The person's answer to the payroll review: lay off what the project has no use for, or keep everyone. */
  settlePayroll: (isLayoff: boolean) => unknown
  /** Opens the usage footer's rows, or closes them. */
  toggleUsage: () => unknown
  /** The coffee break button pressed: the chat is compacted now (or, where the engine cannot, `/compact` is put in the prompt box). */
  coffeeBreak: (isTerminal: boolean) => unknown
  /** Settings shows the list of finished work (true) or its configs again (false). */
  showLog: (isOpen: boolean) => unknown
  /** A config's toggle pressed: the settings row is set to `value`; a refusal is kept as the tab's note. */
  setConfig: (field: ConfigField, value: boolean) => unknown
  /** ▼ (1) or ▲ (-1) pressed under a file's box in Settings: its window moves about 10 lines. */
  scrollClawd: (part: BriefPart, dir: 1 | -1) => unknown
  /** A button on the setup card pressed: the whole button, so a role choice carries its label. */
  choose: (button: OnboardButton) => unknown
}

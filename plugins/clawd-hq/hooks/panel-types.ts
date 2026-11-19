// What the side panel is handed to draw, and the things it may ask for; register-panes.ts fills both.
import type { HistoryRecord } from './history'
import type { OpenGoal } from './history-view'
import type { Artifact, Badge, Boss, ClawdBrief, ContractorOffer, Employee, Fx, Gauge, KnowState, LeftItem, Payroll, PlanState, RuleOffer } from '../types'
import type { ClawdActions } from './clawd-edit'
import type { ConfigField } from './configs'
import type { ContractorActions } from './contractor'
import type { BriefPart, BriefingOptions } from './instructions'
import type { KnowActions } from './know-check'
import type { LeftActions } from './left-io'
import type { OnboardButton, OnboardCard } from './onboard-types'
import type { OldActions } from './old-decisions'
import type { RuleActions } from './rule-io'

export type PanelData = {
  staff: Employee[]
  boss: Boss
  fx: Fx
  tick: number
  blurbs: Record<string, string>
  roster: Record<string, Badge>
  /** The tokens each type used in this project, for the People tab; none for a type with no runs here. */
  projectTokens: Record<string, number>
  payroll: Payroll
  /** The pages Claude published or opened in this project, newest first. */
  artifacts: Artifact[]
  /** What Claude or a specialist left unfinished in this project, newest first. */
  leftUndone: LeftItem[]
  /** The lasting rules Clawd offered to add to the project's CLAUDE.md this session, newest first. */
  ruleOffers: RuleOffer[]
  /** The contractors Clawd has hired more than once here, each offered to be made staff; newest first. */
  contractorOffers: ContractorOffer[]
  gauge: Gauge
  now: number
  /** The notes from the check on finished work waiting on Clawd's card. */
  know: KnowState
  /** What the Settings tab shows of Clawd's instructions and voice notes, and the word left by its last button. */
  brief: ClawdBrief
  /** The plugin's on/off configs and voice file path as this load of the plugin got them. */
  options: BriefingOptions
  /** The goal in hand (hooks/plan-run.ts keeps it); none when there is none. The tab draws it only while Clawd runs the chat. */
  plan: PlanState | null
  /** The setup step drawn under Clawd's card; none, or a finished one, draws nothing. */
  onboard?: OnboardCard
  /** The project's history records (hooks/register-history.ts reads them once and keeps them): drawn by the History tab, read only for it. */
  history?: readonly HistoryRecord[]
  /** The plan files of this folder that another session owns (or no session), for the History tab's Resume (hooks/register-panes.ts lists them; read only for that tab). */
  openGoals?: readonly OpenGoal[]
}

export type PanelActions = KnowActions & ClawdActions & LeftActions & RuleActions & OldActions & ContractorActions & {
  setFind: (tab: 'people', text: string) => unknown
  /** The Hide button on an artifact row: that page leaves this project's desk (not claude.ai) until it is published or opened again. */
  hideArtifact: (url: string) => unknown
  layOff: (type: string) => unknown
  /** The Dismiss button on the card that names who the automatic trim laid off. */
  layoffDismiss: () => unknown
  hire: (type: string) => unknown
  /** A fold of the plan opens or closes (hooks/plan-view.ts `FOLD`): panel state only. */
  toggleFold: (key: string) => unknown
  /** Retry or Ask Clawd on a failed agent: the prompt box is filled with the text, never sent. */
  agentAsk: (prompt: string) => unknown
  /** Resume on another session's open goal (History tab): this session takes the goal over, and the prompt box is filled to carry on, never sent. `slug` is the plan file's name. */
  resumeGoal: (slug: string) => unknown
  /** Do it now on a Later item of the plan: the prompt box is filled, never sent. */
  planLaterDo: (goal: string, id: string) => unknown
  /** Dismiss on a Later item of the plan: that one item leaves the plan file. `goal` is the key of the goal it was drawn for; another goal's press is refused. */
  planLaterDismiss: (goal: string, id: string) => unknown
  /** The History tab could not be drawn from its records (it draws empty instead): the reason, for the history's debug record. */
  historyError: (why: string) => unknown
  /** Opens the usage footer's rows, or closes them. */
  toggleUsage: () => unknown
  /** The coffee break button pressed: the chat is compacted now (or, where the engine cannot, `/compact` is put in the prompt box). */
  coffeeBreak: (isTerminal: boolean) => unknown
  /** A config's toggle handler: changes the plugin's own store to the specified value. Resolves to nothing on success or a plain string on error, and never rejects. */
  setConfig: (field: ConfigField, value: boolean) => unknown
  /** ▼ (1) or ▲ (-1) pressed under a file's box in Settings: its window moves about 10 lines. */
  scrollClawd: (part: BriefPart, dir: 1 | -1) => unknown
  /** A button on the setup card pressed: the whole button, so a role choice carries its label. */
  choose: (button: OnboardButton) => unknown
}

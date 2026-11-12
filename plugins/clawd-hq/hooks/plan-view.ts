// What the Office tab draws of the plan, as pure functions: the goal's rows (done steps folded, the steps now, needing attention or next, who
// is at work under each, who failed), the lines of text each row says, and the prompts the buttons fill in. The drawing is panel-plan.tsx.
import type { Employee, Fx, PlanState, PlanStep } from '../types'
import { doneLine, deskWords, isActive, modelLabel, tokensLabel, workLine } from './panel-model'
import { fit } from './desk'
import { ago } from './office'
import { floorSlots } from './pair-up'
import type { Slot } from './pair-up'
import { blockingFailures, goalKey, statusOf } from './plan-live'
import type { StepStatus } from './plan-live'

/** Agents drawn under a step before "N more at work", and next steps drawn before "N more steps". */
export const SHOWN_AGENTS = 3
export const SHOWN_STEPS = 3

// ---- Folds: which of the plan's folds are open (kept in `Fx`, for the session) ----

/**
 * The keys of the folds. Each begins with the goal's key (`goalKey`; empty with no goal), so a fold the person opened in one goal is not open
 * in the next. A step's "more at work" and an agent's details are named by the step or the run.
 */
export const FOLD = {
  done: (goal: string) => `${goal}|done`,
  steps: (goal: string) => `${goal}|steps`,
  later: (goal: string) => `${goal}|later`,
  more: (goal: string, stepId: string) => `${goal}|more:${stepId}`,
  details: (goal: string, runId: string) => `${goal}|details:${runId}`,
} as const

/** The goal's key as the folds and the Later buttons use it; empty with no goal in hand. */
export const goalOf = (data: { plan: PlanState | null }) => (data.plan === null ? '' : goalKey(data.plan))

export const foldsOf = (fx: Pick<Fx, 'folds'>): ReadonlySet<string> => new Set(fx.folds)

/** The list of open folds with one opened or closed; a new list, kept in the order they were opened. */
export const withFold = (folds: readonly string[] | undefined, key: string): string[] => {
  const list = folds ?? []
  return list.includes(key) ? list.filter(one => one !== key) : [...list, key]
}

// ---- The rows ----

/** A step that is not done, with who is on it. */
export type StepBlock = {
  step: PlanStep
  status: Exclude<StepStatus, 'done'>
  /** The latest failure that still holds the step back (`blockingFailures`): its card is listed first and never folded. */
  failed: Employee[]
  /** Failures that hold it back besides the one shown: "N earlier failed". */
  earlierFailed: number
  /** The blocks drawn under the step: up to three, or all when its fold is open. A pair-up or a council is one block. */
  shown: Slot[]
  /** Specialists at work in the blocks that are folded away. */
  hidden: number
  /** Blocks past the third: the fold's button shows while there are any. */
  moreBlocks: number
  /** Specialists at work on the step. */
  atWork: number
  isMoreOpen: boolean
}

export type PlanLayout = {
  title: string
  /** The goal in one sentence, drawn dim under the title; absent when the plan has none. */
  summary?: string
  done: number
  total: number
  /** The finished steps, in the plan's order. */
  doneSteps: PlanStep[]
  /** The last finished step in the plan's order: drawn as a done row of its own, never folded. (A tick carries no time, so the order stands for "last".) */
  lastDone?: PlanStep
  /** The finished steps before it, folded into "N steps done". */
  earlierDone: PlanStep[]
  /** The steps now, needing attention, or next that are drawn. */
  steps: StepBlock[]
  /** Next steps past the third: folded away, or shown when the fold is open. */
  extraSteps: number
  isStepsOpen: boolean
  /** At work and under no step of this goal: they are drawn as "Also at work". */
  outsiders: Employee[]
}

const members = (slot: Slot) => (slot.kind === 'one' ? [slot.one] : slot.group.members)
/** The specialists of a block that are at work; a pair-up with one member done still counts the other. */
const working = (slot: Slot) => members(slot).filter(isActive).length

export function planLayout(state: PlanState, staff: readonly Employee[], folds: ReadonlySet<string>): PlanLayout {
  const key = goalKey(state)
  const open = state.steps.filter(step => !step.isDone)
  const runsOn = (step: PlanStep) => staff.filter(one => one.stepId === step.id && one.planKey === key)
  const blockOf = (step: PlanStep): StepBlock => {
    const runs = runsOn(step)
    // Pair-ups are made from every run of the step, then kept while a member is still at work: one that finished does not break the pair.
    const slots = floorSlots(runs)
    const isMoreOpen = folds.has(FOLD.more(key, step.id))
    const shown = isMoreOpen ? slots : slots.slice(0, SHOWN_AGENTS)
    const inBlocks = new Set(slots.flatMap(slot => members(slot).map(one => one.id)))
    const blocking = blockingFailures(step, runs).filter(one => !inBlocks.has(one.id))
    return {
      step, status: statusOf(step, staff, key) as StepBlock['status'], failed: blocking.slice(0, 1), earlierFailed: Math.max(0, blocking.length - 1), shown, isMoreOpen,
      hidden: slots.slice(shown.length).reduce((n, slot) => n + working(slot), 0), moreBlocks: Math.max(0, slots.length - SHOWN_AGENTS),
      atWork: slots.reduce((n, slot) => n + working(slot), 0),
    }
  }
  const blocks = open.map(blockOf)
  const isStepsOpen = folds.has(FOLD.steps(key))
  const nextSeen = blocks.reduce<number[]>((all, block) => [...all, (all[all.length - 1] ?? 0) + (block.status === 'next' ? 1 : 0)], [])
  // The first three next steps are drawn; the rest only when the fold is open. A step now or needing attention is always drawn.
  const steps = blocks.filter((block, i) => block.status !== 'next' || isStepsOpen || nextSeen[i]! <= SHOWN_STEPS)
  const placed = new Set(open.map(step => step.id))
  const doneSteps = state.steps.filter(step => step.isDone)
  return {
    title: state.title, ...(state.summary === undefined ? {} : { summary: state.summary }), done: state.steps.length - open.length, total: state.steps.length,
    doneSteps, lastDone: doneSteps[doneSteps.length - 1], earlierDone: doneSteps.slice(0, -1), steps,
    extraSteps: Math.max(0, (nextSeen[nextSeen.length - 1] ?? 0) - SHOWN_STEPS), isStepsOpen,
    outsiders: staff.filter(one => isActive(one) && !(one.planKey === key && one.stepId !== undefined && placed.has(one.stepId))),
  }
}

// ---- The words ----

/** "Sonnet 5.5 · 2m · 41K": model, how long it has worked, tokens; what is not known is left out. The effort level is left off. */
export function statsLine(one: Employee, now: number): string {
  const end = isActive(one) ? now : one.endedAt ?? now
  return [modelLabel(one.model), ago(end - one.startedAt), one.tokens ? tokensLabel(one.tokens) : undefined].filter((part): part is string => part !== undefined).join(' · ')
}

/** What an agent at work says on its second line: its last words, or the sentence for what it does now. */
export function agentWords(one: Employee, now: number): { text: string; isSaid: boolean } {
  const { said, sentence } = deskWords(one, workLine(one, now))
  return said === undefined ? { text: sentence, isSaid: false } : { text: said, isSaid: true }
}

/** Where it stopped, from what it reported with the step tool: "Step 3 of 5: writing the file"; nothing before it reported. */
export function stoppedAt(one: Employee): string | undefined {
  if (one.stepTotal === undefined) return undefined
  return `Stopped at step ${Math.min(one.stepDone ?? 0, one.stepTotal)} of ${one.stepTotal}${one.stepNote ? `: ${one.stepNote}` : ''}`
}

const REASON_CHARS = 90

/** "Failed after 1m: there is no test database", cut to a line; without a known reason, the first part alone. */
export function failureLine(one: Employee, now: number): string {
  const head = doneLine(one, now).took
  return one.reason === undefined || one.reason === '' ? head : `${head}: ${fit(one.reason, REASON_CHARS)}`
}

/** How a done step reads in the open done fold: who did it, how long, how many tokens. Several runs: their count and totals. A step ticked by hand says nothing. */
export function doneInfo(step: PlanStep, staff: readonly Employee[], key: string, label: (one: Employee) => string): string {
  const runs = staff.filter(one => one.stepId === step.id && one.planKey === key && one.mood === 'done')
  if (runs.length === 0) return ''
  const span = runs.reduce((n, one) => n + Math.max(0, (one.endedAt ?? one.startedAt) - one.startedAt), 0)
  const tokens = runs.reduce((n, one) => n + (one.tokens ?? 0), 0)
  return [runs.length === 1 ? label(runs[0]!) : `${runs.length} agents`, ago(span), tokens > 0 ? tokensLabel(tokens) : undefined].filter((part): part is string => part !== undefined).join(' · ')
}

// ---- What the buttons put in the prompt box ----

const reasonOf = (one: Employee) => (one.reason === undefined || one.reason === '' ? 'it did not say why' : fit(one.reason, 300).replace(/[.!?]+$/, ''))

/** Retry: asks Clawd to hire it again. Fills the box; never sends. */
export const retryPrompt = (name: string, one: Employee) => `${name} failed: ${reasonOf(one)}. Hire it again once that is fixed.`

/** Ask Clawd: asks what went wrong and what to do next. Fills the box; never sends. */
export const askPrompt = (name: string, one: Employee) => `${name} failed: ${reasonOf(one)}. What went wrong, and what should we do about it?`

/** Do it now on a Later item of the plan. */
export const laterPrompt = (text: string) => `You put this off: ${text.replace(/[.!?]+$/, '')}. Do it now.`

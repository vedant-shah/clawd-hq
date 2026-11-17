// The plan as the session holds it (pure): the state built from a plan file's view, which step is now, needs attention or next (worked out
// from the runs, never kept), whether a run that ended well ticks its step, the short text Clawd is answered with, and the `plan` tool's
// input read into one call. No `$`: hooks/plan-run.ts does the work and register-plan.ts hands it the host.
import type { Employee, PlanState, PlanStep } from '../types'
import { fit } from './desk'
import { isActive } from './panel-model'
import type { PlanOp, PlanView } from './plan'

/** Where a step stands. `attention`: not done, nobody on it, and its latest run failed or lost contact. */
export type StepStatus = 'done' | 'now' | 'attention' | 'next'

/**
 * Which goal a run belongs to: the plan file's name and when the goal started. A run is linked to a step of one goal; the same id in a
 * later goal (the new goal's s2) is another step, and the earlier goal's runs never count for it.
 */
export const goalKey = (state: Pick<PlanState, 'slug' | 'startedAt'>) => `${state.slug}:${state.startedAt}`

/** The runs linked to this step of this goal. */
const runsOn = (staff: readonly Employee[], key: string, id: string) => staff.filter(one => one.stepId === id && one.planKey === key)

/** The steps of this goal with a specialist at work on them. */
export function activeStepIds(staff: readonly Employee[], key: string): Set<string> {
  return new Set(staff.filter(one => one.stepId !== undefined && one.planKey === key && isActive(one)).map(one => one.stepId!))
}

/**
 * The failures that still hold a step back, newest first. ONE rule for the failed card, the step's status and the tick. A run that failed or
 * lost contact is no longer held against the step when (a) it ended before a later run that ended well began (a rerun covers it; a run
 * that overlapped the success does not), or (b) it began before the step was last reopened. Every other failure blocks.
 */
export function blockingFailures(step: PlanStep, runs: readonly Employee[]): Employee[] {
  const since = step.reopenedAt ?? 0
  return runs
    .filter(one => one.mood === 'failed' || one.mood === 'lost')
    .filter(one => one.startedAt >= since && !runs.some(later => later.mood === 'done' && later.startedAt > (one.endedAt ?? one.startedAt)))
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
}

/** Worked out each time from the books: now while a linked run is at work; needs attention when nobody is on it and a failure still blocks it. */
export function statusOf(step: PlanStep, staff: readonly Employee[], key: string): StepStatus {
  if (step.isDone) return 'done'
  const runs = runsOn(staff, key, step.id)
  if (runs.some(isActive)) return 'now'
  return blockingFailures(step, runs).length > 0 ? 'attention' : 'next'
}

/**
 * Whether the run that just handed back ticks its step: it ended well, the step is open, no other run linked to it is at work, and no failure
 * still blocks it (`blockingFailures`). DECIDED (the owner): a rerun that succeeds ticks the step, so a failure that ended before this run
 * began no longer blocks; one that overlapped it does. A run that ended before the step was reopened ticks nothing. Only this goal's runs count.
 * Known limit: members of a pair-up hired seconds apart on one step can tick it when the first hands back, before the second starts.
 */
export function tickDue(state: PlanState, staff: readonly Employee[], run: Employee): boolean {
  const step = state.steps.find(one => one.id === run.stepId)
  const key = goalKey(state)
  if (step === undefined || step.isDone || run.mood !== 'done' || run.planKey !== key) return false
  if ((run.endedAt ?? 0) < (step.reopenedAt ?? 0)) return false
  const runs = runsOn(staff, key, step.id)
  if (runs.some(one => one.id !== run.id && isActive(one))) return false
  return blockingFailures(step, runs).length === 0
}

const isTicked = (state: PlanState) => state.steps.length > 0 && state.steps.every(step => step.isDone)

/**
 * What a goal whose steps are all ticked should do now: `close` (end it as done), `held` (a specialist of this goal is still at work, so it
 * waits), or `none`. A goal is ticked-through, with at least one step (a goal with none never closes by itself), and not `isStuck`.
 * DECIDED: it is a candidate when `before` was not ticked through (the change just ticked its last step), or when this session has worked on
 * it (a run linked to it is on the books): so a goal held back by a run closes when that run is no longer at work, with no new tick. A plan
 * that was already ticked through when loaded, with no run of this session on it, is left for Clawd to finish.
 */
export function closeDue(before: PlanState | null, after: PlanState, staff: readonly Employee[]): 'close' | 'held' | 'none' {
  const key = goalKey(after)
  if (!isTicked(after) || after.isStuck === true) return 'none'
  const isCandidate = (before !== null && !isTicked(before)) || staff.some(one => one.planKey === key)
  if (!isCandidate) return 'none'
  return activeStepIds(staff, key).size > 0 ? 'held' : 'close'
}

/** The plan state for a file's view: each step keeps its mark and its reopening from before; steps new to the state, and `touched` ones, are marked new. */
export function stateFrom(view: PlanView, slug: string, startedAt: number, prev: PlanState | null, touched: readonly string[]): PlanState {
  const old = prev !== null && prev.slug === slug ? prev.steps : undefined
  const steps = view.steps.map((step): PlanStep => {
    const before = old?.find(one => one.id === step.id)
    const isNew = (before === undefined && old !== undefined) || touched.includes(step.id) || before?.isNew === true
    return { ...step, ...(isNew ? { isNew: true } : {}), ...(before?.reopenedAt === undefined ? {} : { reopenedAt: before.reopenedAt }) }
  })
  const isStuck = prev !== null && prev.slug === slug && prev.isStuck === true && steps.length > 0 && steps.every(step => step.isDone)
  return { slug, title: view.title, ...(view.summary === undefined ? {} : { summary: view.summary }), steps, later: view.later, startedAt: prev !== null && prev.slug === slug ? prev.startedAt : startedAt, ...(isStuck ? { isStuck: true as const } : {}) }
}

/** The steps an operation added or changed, for the "new" mark: a start marks them all; done, reopen and move mark the one they changed. */
export function touchedBy(prev: PlanState | null, view: PlanView, op: PlanOp | { op: 'start' }): string[] {
  if (op.op === 'start') return view.steps.map(step => step.id)
  if (op.op === 'done' || op.op === 'reopen') {
    const before = prev?.steps.find(step => step.id === op.id)
    const after = view.steps.find(step => step.id === op.id)
    return before !== undefined && after !== undefined && before.isDone !== after.isDone ? [op.id] : []
  }
  if (op.op === 'move') {
    const [was, now] = [prev?.steps.map(step => step.id) ?? [], view.steps.map(step => step.id)]
    return was.join() === now.join() ? [] : [op.id]
  }
  return []
}

/** The step reopened, with the time: runs that started before it no longer count against ticking it. */
export function withReopened(state: PlanState, id: string, at: number): PlanState {
  return { ...state, steps: state.steps.map(step => (step.id === id ? { ...step, reopenedAt: at } : step)) }
}

/** The state with every "new" mark cleared (the same state when none is set). */
export function clearNew(state: PlanState): PlanState {
  if (!state.steps.some(step => step.isNew === true)) return state
  return { ...state, steps: state.steps.map(({ isNew: _mark, ...rest }) => rest) }
}

const WORD: Record<StepStatus, string> = { done: 'done', now: 'now', attention: 'attention', next: 'next' }
const WIDTH = 9

/**
 * The plan as Clawd is answered with it after every call: the title and the count, the summary (when there is one), then one line per step with its id and where it
 * stands, so he can name a step in his next brief, then the Later items. DECIDED: ticked steps are listed too, so `reopen` has an id to use.
 */
export function planText(state: PlanState, staff: readonly Employee[]): string {
  const key = goalKey(state)
  const done = state.steps.filter(step => step.isDone).length
  const steps = state.steps.map(step => `${step.id} ${WORD[statusOf(step, staff, key)].padEnd(WIDTH)} ${fit(step.text, 120)}`)
  const later = state.later.map(item => `${item.id} ${'later'.padEnd(WIDTH)} ${fit(item.text, 120)}`)
  const summary = state.summary === undefined ? [] : [`Summary: ${fit(state.summary, 120)}`]
  return [`Plan: ${fit(state.title, 120)} (${done} of ${state.steps.length} done)`, ...summary, ...steps, ...later].join('\n')
}

// ---- The tool's input ----

/** One call of the `plan` tool, read: starting or finishing a goal, or one operation on the plan in hand. */
export type PlanCall =
  | { kind: 'start'; goal: unknown; steps: readonly unknown[]; summary?: unknown }
  | { kind: 'finish'; outcome: 'done' | 'stopped' }
  | { kind: 'op'; op: PlanOp }

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const idOf = (value: unknown) => text(value).trim().toLowerCase()
const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [])

/** The call a tool input asks for, or the one plain sentence why not. The input is Clawd's, so every field is checked. */
export function parseCall(input: Record<string, unknown>): { call: PlanCall } | { error: string } {
  const op = text(input.op)
  const id = idOf(input.id)
  const needsId = { error: 'Give the id of the step, such as s2.' }
  const after = idOf(input.after) === '' ? {} : { after: idOf(input.after) }
  switch (op) {
    case 'start': return { call: { kind: 'start', goal: input.goal, steps: list(input.steps), ...(input.summary === undefined ? {} : { summary: input.summary }) } }
    case 'finish': return input.outcome === 'done' || input.outcome === 'stopped' ? { call: { kind: 'finish', outcome: input.outcome } } : { error: 'Say how the goal ended: outcome "done" or "stopped".' }
    case 'add': return { call: { kind: 'op', op: { op: 'add', text: text(input.text), ...after } } }
    case 'later': return { call: { kind: 'op', op: { op: 'later', text: text(input.text) } } }
    case 'summary': return { call: { kind: 'op', op: { op: 'summary', text: text(input.text) } } }
    case 'drop': case 'done': case 'reopen': return id === '' ? needsId : { call: { kind: 'op', op: { op, id } } }
    case 'move': return id === '' ? needsId : { call: { kind: 'op', op: { op: 'move', id, ...after } } }
    case 'split': return id === '' ? needsId : { call: { kind: 'op', op: { op: 'split', id, steps: list(input.steps) } } }
    default: return { error: 'The op must be one of: start, add, drop, move, split, done, reopen, later, summary, finish.' }
  }
}

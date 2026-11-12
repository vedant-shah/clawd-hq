// The plan at work (no `$`): the `plan` tool's answers, loading the goal in hand, linking a run to its step, and ticking a step when its run ends
// well. The plan file is the truth; the state (`PlanState`, hooks/plan-live.ts) is what the session holds of it. register-plan.ts hands in
// what each call may do as `PlanRunIo`. Nothing here may break the person's turn: a failure is an answer or a debug record, never thrown.
import type { Employee, PlanState, PlanStep } from '../types'
import { fit } from './desk'
import { activeStepIds, clearNew, goalKey, parseCall, planText, stateFrom, tickDue, touchedBy, withReopened } from './plan-live'
import type { PlanCall } from './plan-live'
import { GONE, changeGoal, finishGoal, loadGoals, saveIds, startGoal } from './plan-io'
import type { PlanIo } from './plan-io'
import type { PlanOp, PlanView } from './plan'

/** How a goal ended, as the history record will want it (Phase 4 writes the `goal_end` record from this). */
export type GoalEnd = { slug: string; title: string; outcome: 'done' | 'stopped'; startedAt: number; endedAt: number; steps: PlanStep[] }

/** What the plan may do, each one a `$` call made in register-plan.ts. */
export type PlanRunIo = {
  /** "Clawd runs the chat" is on. Off: the tool is refused and no plan is loaded. */
  isOn: () => boolean
  /** The session's project folder; '' when there is none. */
  root: () => string
  files: PlanIo
  now: () => Promise<number>
  get: () => Promise<PlanState | null>
  /** Changes the state in one write and gives back what it now holds. The change may run more than once, so it must be repeatable. */
  set: (fn: (state: PlanState | null) => PlanState | null) => Promise<PlanState | null>
  staff: () => Promise<Employee[]>
  /** Keeps the Later items of a goal that ended on the project's list (hooks/left-io.ts). */
  keepLater: (texts: string[]) => Promise<void>
  /** SEAM (Phase 4): the `goal_end` record in history.jsonl is written here. Called once, before the Later items are kept and the file is emptied; a throw is recorded and does not stop the finish. */
  goalEnded: (end: GoalEnd) => Promise<void>
}

/** Where the lines of swallowed failures are kept in the plugin's store (the newest few only, never a word of the chat). */
export const PLAN_DEBUG_KEY = 'debug:plan'
const NOTES_KEPT = 20

/** The record with one more line, the newest twenty kept. The store's copy is read as a list, whatever it holds. */
export function withPlanNote(raw: unknown, line: string, at: number): Array<{ at: number; note: string }> {
  const list = Array.isArray(raw) ? raw.filter((one): one is { at: number; note: string } => typeof one === 'object' && one !== null && typeof (one as { at?: unknown }).at === 'number' && typeof (one as { note?: unknown }).note === 'string') : []
  return [...list, { at, note: fit(line, 300) }].slice(-NOTES_KEPT)
}

type Answer = { readonly result: string } | { readonly deny: string }

export const DENY_SPECIALIST = 'Only Clawd keeps the plan. Put what you want changed in your report for Clawd.'
export const DENY_OFF = 'The plan is off while "Clawd runs the chat" is off.'
const NO_GOAL = 'There is no goal in hand. Start one first: op "start" with a goal and its steps.'
const GOAL_GONE = 'The plan file of this goal is gone (another session may have ended it), so the plan was cleared. Start a new goal if there is more to do.'

/** A debug line for a failure that was swallowed; a record that cannot be written changes nothing. */
async function note(io: PlanRunIo, line: string) {
  try {
    await io.files.debug(`plan: ${line}`)
  } catch { /* the record is only a way to look */ }
}

/**
 * The newest plan file in the project becomes the goal in hand, its provisional ids saved first. With Clawd off, none is loaded and none is
 * kept. A reload of the goal already in hand keeps what only the session knows of it (its reopenings, its "new" marks, its start time).
 * Never throws.
 */
export async function loadPlan(io: PlanRunIo): Promise<void> {
  try {
    const newest = io.isOn() ? (await loadGoals(io.files, io.root()))[0] : undefined
    if (newest === undefined) {
      await io.set(() => null)
      return
    }
    const hold = (view: PlanView) => io.set(prev => stateFrom(view, newest.slug, newest.mtimeMs, prev, []))
    const saved = await saveIds(io.files, io.root(), newest.slug, hold)
    if (!saved.ok) await hold(newest.plan)
  } catch (err) {
    await note(io, `could not load the plan: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const deny = (reason: string): Answer => ({ deny: reason })

async function start(io: PlanRunIo, call: { goal: unknown; steps: readonly unknown[]; summary?: unknown }): Promise<Answer> {
  const root = io.root()
  const hasCurrent = async () => (await io.get()) !== null || (await loadGoals(io.files, root)).length > 0
  const made = await startGoal(io.files, root, { ...call, hasCurrent })
  if (!made.ok) return deny(made.reason)
  const at = await io.now()
  const next = await io.set(prev => stateFrom(made.plan, made.slug, at, null, touchedBy(prev, made.plan, { op: 'start' })))
  return { result: next === null ? '' : planText(next, await io.staff()) }
}

/** A plan file that is gone clears the state, so a ghost goal does not stay. */
async function refused(io: PlanRunIo, reason: string): Promise<Answer> {
  if (reason !== GONE) return deny(reason)
  await io.set(() => null)
  return deny(GOAL_GONE)
}

async function operate(io: PlanRunIo, state: PlanState, call: Extract<PlanCall, { kind: 'op' }>): Promise<Answer> {
  const at = await io.now()
  const key = goalKey(state)
  let next: PlanState | null = null
  const done = await changeGoal(io.files, io.root(), state.slug, call.op, async () => activeStepIds(await io.staff(), key), async plan => {
    next = await io.set(prev => {
      if (prev === null) return prev
      const marked = stateFrom(plan, state.slug, state.startedAt, prev, touchedBy(prev, plan, call.op))
      return call.op.op === 'reopen' ? withReopened(marked, call.op.id, at) : marked
    })
  })
  if (!done.ok) return refused(io, done.reason)
  const held = next as PlanState | null
  return { result: held === null ? '' : planText(held, await io.staff()) }
}

async function finish(io: PlanRunIo, state: PlanState, outcome: 'done' | 'stopped'): Promise<Answer> {
  let kept = 0
  const ended = await finishGoal(io.files, io.root(), state.slug, async later => {
    try {
      await io.goalEnded({ slug: state.slug, title: state.title, outcome, startedAt: state.startedAt, endedAt: await io.now(), steps: state.steps })
    } catch (err) {
      await note(io, `the end of the goal could not be recorded: ${err instanceof Error ? err.message : String(err)}`)
    }
    // Every put-off item is kept or the goal is not ended: a failure here is refused (and the file left as it is), never let go.
    await io.keepLater(later)
    kept = later.length
  }, () => io.set(() => null))
  if (!ended.ok) return refused(io, ended.reason)
  const moved = kept === 0 ? 'There were no put-off items to move.' : `${kept} put-off ${kept === 1 ? 'item was' : 'items were'} moved to the project's Later list.`
  return { result: `The goal "${fit(state.title, 120)}" is over (${outcome}). ${moved} There is no goal in hand now.` }
}

/**
 * Clawd's call of the `plan` tool. A specialist's call is refused, and so is any call while Clawd is off. Every answer is the plan in short
 * text with its ids, or one plain sentence why not. Never throws.
 */
export async function planTool(io: PlanRunIo, agentId: string | undefined, input: Record<string, unknown>): Promise<Answer> {
  if (agentId !== undefined) return deny(DENY_SPECIALIST)
  if (!io.isOn()) return deny(DENY_OFF)
  const parsed = parseCall(input)
  if ('error' in parsed) return deny(parsed.error)
  const call = parsed.call
  try {
    if (call.kind === 'start') return await start(io, call)
    // A goal left in the project by an earlier session (or one that Clawd's being off kept from loading) is picked up here.
    if ((await io.get()) === null) await loadPlan(io)
    const state = await io.get()
    if (state === null) return deny(NO_GOAL)
    return call.kind === 'finish' ? await finish(io, state, call.outcome) : await operate(io, state, call)
  } catch (err) {
    await note(io, `a call of the plan tool failed: ${err instanceof Error ? err.message : String(err)}`)
    return deny(`The plan could not be changed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Whether a `PLAN: <step id>` line names a step of the plan in hand: the goal's key to link the run with, or nothing. A line that names no
 * step books the run off-plan, with a debug record; the hire is never refused. With Clawd off nothing is linked and nothing is recorded.
 */
export async function linkStep(io: PlanRunIo, stepId: string): Promise<string | undefined> {
  if (!io.isOn()) return undefined
  let state: PlanState | null
  try {
    state = await io.get()
  } catch (err) {
    await note(io, `could not read the plan to link a run to ${fit(stepId, 20)}: ${err instanceof Error ? err.message : String(err)}`)
    return undefined
  }
  if (state?.steps.some(step => step.id === stepId) === true) return goalKey(state)
  await note(io, `a brief named the step "${fit(stepId, 20)}", which is not in the plan${state === null ? ' (there is none)' : ''}; the run is booked off-plan`)
  return undefined
}

/**
 * A linked run handed its report back. Its choices go under the step; and when it ended well and nothing else holds the step back
 * (hooks/plan-live.ts, `tickDue`) the step is ticked, in the same write. Only a hand-back does this (the caller is the hand-back path, once
 * per hand-back): a run that merely stopped, or that the engine's list says is done, ticks nothing. A run of an earlier goal does nothing
 * to this one. Never ends the goal. Safe to call again for the same run. Never throws.
 */
export async function settleRun(io: PlanRunIo, runId: string): Promise<void> {
  try {
    if (!io.isOn()) return
    const state = await io.get()
    if (state === null) return
    const run = (await io.staff()).find(one => one.id === runId)
    if (run?.stepId === undefined || run.mood !== 'done' || run.planKey !== goalKey(state) || !state.steps.some(step => step.id === run.stepId)) return
    const stepId = run.stepId
    // Worked out in the queue, from the books as they are then: a change just before may have reopened the step or given it another run.
    const op = async (): Promise<PlanOp> => {
      const [held, staff] = [await io.get(), await io.staff()]
      const now = staff.find(one => one.id === runId)
      return { op: 'decide', id: stepId, choices: now?.choices ?? [], tick: held !== null && now !== undefined && tickDue(held, staff, now) }
    }
    const done = await changeGoal(io.files, io.root(), state.slug, op, new Set<string>(), async plan => {
      await io.set(prev => (prev !== null && prev.slug === state.slug ? stateFrom(plan, state.slug, prev.startedAt, prev, []) : prev))
    })
    if (!done.ok) await note(io, `a step could not be ticked: ${done.reason}`)
  } catch (err) {
    await note(io, `a step could not be ticked: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Dismiss on a Later item of the plan: that one item leaves the plan file and the state. `goal` is the key of the goal the press was drawn for:
 * a press from a tab drawn before the goal changed is refused with a debug record, so it cannot take the next goal's item. Never throws.
 */
export async function dismissLater(io: PlanRunIo, goal: string, id: string): Promise<void> {
  try {
    const state = io.isOn() ? await io.get() : null
    if (state === null) return
    if (goalKey(state) !== goal) {
      await note(io, `a Dismiss was pressed for another goal (${fit(goal, 40)}), so it was refused`)
      return
    }
    const done = await changeGoal(io.files, io.root(), state.slug, { op: 'forget', id }, new Set<string>(), async plan => {
      await io.set(prev => (prev !== null && prev.slug === state.slug ? stateFrom(plan, state.slug, prev.startedAt, prev, []) : prev))
    })
    if (!done.ok) await note(io, `a Later item could not be dismissed: ${done.reason}`)
  } catch (err) {
    await note(io, `a Later item could not be dismissed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** The person sent a message: the "new" marks on the plan go. Nothing is written when none is set. */
export async function clearNewMarks(io: PlanRunIo): Promise<void> {
  try {
    const state = await io.get()
    if (state !== null && clearNew(state) !== state) await io.set(prev => (prev === null ? prev : clearNew(prev)))
  } catch (err) {
    await note(io, `the new marks could not be cleared: ${err instanceof Error ? err.message : String(err)}`)
  }
}

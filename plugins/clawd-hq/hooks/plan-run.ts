// The plan at work (no `$`): the `plan` tool's answers, loading the goal in hand, linking a run to its step, and ticking a step when its run ends
// well. The plan file is the truth; the state (`PlanState`, hooks/plan-live.ts) is what the session holds of it. register-plan.ts hands in
// what each call may do as `PlanRunIo`. Nothing here may break the person's turn: a failure is an answer or a debug record, never thrown.
import type { Employee, PlanState, PlanStep } from '../types'
import { fit } from './desk'
import { activeStepIds, clearNew, closeDue, goalKey, parseCall, planText, stateFrom, tickDue, touchedBy, withReopened } from './plan-live'
import type { PlanCall } from './plan-live'
import { GONE, TAKEN, changeGoal, claimGoal, finishGoal, loadGoals, saveIds, startGoal } from './plan-io'
import type { Guard, PlanIo } from './plan-io'
import { SESSION_ID } from './plan-file'
import type { PlanOp, PlanView } from './plan'
import { cleanText } from './plan'
import { looksSecret } from './know'
import { DRAFT_MS, draftNote, parseSteps, sameTitle, startedNote } from './plan-draft'
import type { PlanDraft } from './plan-draft'

/** How a goal ended, as the history record will want it (Phase 4 writes the `goal_end` record from this). */
export type GoalEnd = { slug: string; title: string; summary?: string; outcome: 'done' | 'stopped'; startedAt: number; endedAt: number; steps: PlanStep[] }

/** What the plan may do, each one a `$` call made in register-plan.ts. */
export type PlanRunIo = {
  /** "Clawd runs the chat" is on. Off: the tool is refused and no plan is loaded. */
  isOn: () => boolean
  /** The session's project folder; '' when there is none. */
  root: () => string
  files: PlanIo
  now: () => Promise<number>
  /** This session's id (`$.session.id()`; "unknown" where the host cannot say). A goal belongs to the session that started it, or took it over. */
  session: () => Promise<string>
  get: () => Promise<PlanState | null>
  /** Changes the state in one write and gives back what it now holds. The change may run more than once, so it must be repeatable. */
  set: (fn: (state: PlanState | null) => PlanState | null) => Promise<PlanState | null>
  staff: () => Promise<Employee[]>
  /** Keeps the Later items of a goal that ended on the project's list (hooks/left-io.ts). */
  keepLater: (texts: string[]) => Promise<void>
  /** The `goal_start` record of history.jsonl, once a new plan is saved; a throw is recorded and does not undo the start. */
  goalStarted: (start: { slug: string; title: string; summary?: string; steps: number; by: 'clawd' | 'planner' }) => Promise<void>
  /** The `goal_end` record of the history. Called once, after the finish went through (the Later items kept, the file emptied), outside the plan files' write queue; a throw is recorded. */
  goalEnded: (end: GoalEnd) => Promise<void>
  /** The Planner's plan waiting for Clawd in a project folder (one at most), kept in memory and in the plugin's store, never as a plan file. `set` reads the store again, changes it in one write and gives back what it now holds. */
  draft: { get: (folder: string) => Promise<PlanDraft | null>; set: (folder: string, fn: (draft: PlanDraft | null) => PlanDraft | null) => Promise<PlanDraft | null> }
  /** When a goal began by its `goal_start` record in the history: for a plan from before the file kept its own `started` line. */
  goalStartedAt: (slug: string) => Promise<number | undefined>
  /** Lines for Clawd that wait for his next `plan` answer, kept for the session: a hand-back that found no goal. `set` changes the list in one write and gives back what it now holds. */
  notes: { get: () => Promise<string[]>; set: (fn: (lines: string[]) => string[]) => Promise<string[]> }
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
const NO_GOAL = 'There is no goal in hand (a goal closes by itself when its last step is ticked). Start one first: op "start" with a goal and its steps.'
/** Added after the plan, in the answer of the call that ticked the goal's last step. */
const CLOSED = 'The goal is complete and closed.'
const GOAL_GONE = 'The plan file of this goal is gone (another session may have ended it), so the plan was cleared. Start a new goal if there is more to do.'
const HAS_GOAL = 'This session already has a goal in hand. Finish or stop it first.'
const GOAL_TAKEN ='This goal was taken over by another session (it was resumed there), so it was cleared here and left as it is. Start a new goal if there is more to do.'

/** A debug line for a failure that was swallowed; a record that cannot be written changes nothing. */
async function note(io: PlanRunIo, line: string) {
  try {
    await io.files.debug(`plan: ${line}`)
  } catch { /* the record is only a way to look */ }
}

/** The plan files of this folder that this session owns, newest first. A plan of no session (saved before plan files named one) is no one's, and so is another session's. */
async function ownGoals(io: PlanRunIo): Promise<Awaited<ReturnType<typeof loadGoals>>> {
  const me = await io.session()
  return (await loadGoals(io.files, io.root())).filter(goal => goal.plan.session === me)
}

/** How many titles the "no goal in hand" answer names. */
const NAMED_GOALS = 3

/**
 * The answer when there is no goal in hand. When the folder holds goals this session does not own (another session's, or a plan file saved
 * before plan files named a session; the History tab lists them), it names them, so Clawd can tell the person: a session never takes a goal over
 * by itself, only the person's Resume does.
 */
async function noGoalText(io: PlanRunIo): Promise<string> {
  const me = await io.session()
  const others = (await loadGoals(io.files, io.root())).filter(goal => goal.plan.session !== me)
  if (others.length === 0) return NO_GOAL
  const titles = others.slice(0, NAMED_GOALS).map(goal => `"${fit(goal.plan.title, 60)}"`).join(', ')
  const more = others.length > NAMED_GOALS ? ` and ${others.length - NAMED_GOALS} more` : ''
  return `${NO_GOAL} Goals left open in this folder by other sessions, or saved before goals named a session: ${titles}${more}. This session does not take them over by itself: tell the person they can press Resume on one in the History tab.`
}

/**
 * The newest plan file of this session in the project becomes the goal in hand, its provisional ids saved first. DECIDED: only a goal this
 * session owns is taken (the session that started it, or took it over from the History tab); another session's open goal, and a plan file
 * with no session (saved before plan files named one), wait in the History tab for a Resume. With Clawd off, none is loaded and none is
 * kept. A reload of the goal already in hand keeps what only the session knows of it (its reopenings, its "new" marks, its start time).
 * Never throws.
 */
export async function loadPlan(io: PlanRunIo): Promise<void> {
  try {
    const newest = io.isOn() ? (await ownGoals(io))[0] : undefined
    if (newest === undefined) {
      await io.set(() => null)
      return
    }
    // When the goal began: its file's `started` line; a plan from before the line, its goal_start record, else (a guess, noted) the file's time.
    const began = newest.plan.startedAt ?? (await io.goalStartedAt(newest.slug).catch(() => undefined))
    if (began === undefined) await note(io, `the plan ${newest.slug} has no start time: its file's time is used, a guess`)
    const startedAt = began ?? newest.mtimeMs
    const hold = (view: PlanView) => io.set(prev => stateFrom(view, newest.slug, startedAt, prev, []))
    const saved = await saveIds(io.files, io.root(), newest.slug, hold, { owner: newest.plan.session })
    if (!saved.ok) await (saved.reason === TAKEN ? io.set(() => null) : hold(newest.plan)) // taken over between the listing and now: not this session's any more
  } catch (err) {
    await note(io, `could not load the plan: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const deny = (reason: string): { readonly deny: string } => ({ deny: reason })

async function start(io: PlanRunIo, call: { goal: unknown; steps: readonly unknown[]; summary?: unknown }, by: 'clawd' | 'planner' = 'clawd'): Promise<Answer> {
  const root = io.root()
  // One goal at a time for THIS session: another session's open goal in the folder (or a plan of no session) does not stand in the way.
  const hasCurrent = async () => (await io.get()) !== null || (await ownGoals(io)).length > 0
  const at = await io.now()
  const made = await startGoal(io.files, root, { ...call, startedAt: at, session: await io.session(), hasCurrent })
  if (!made.ok) return deny(made.reason)
  const next = await io.set(prev => stateFrom(made.plan, made.slug, at, null, touchedBy(prev, made.plan, { op: 'start' })))
  try {
    await io.goalStarted({ slug: made.slug, title: made.plan.title, ...(made.plan.summary === undefined ? {} : { summary: made.plan.summary }), steps: made.plan.steps.length, by })
  } catch (err) {
    await note(io, `the start of the goal could not be recorded: ${err instanceof Error ? err.message : String(err)}`)
  }
  await io.draft.set(root, () => null).catch(() => undefined) // a plan is in hand now: a draft that waited is spent, started or set aside by Clawd's own start
  return { result: next === null ? '' : planText(next, await io.staff()) }
}

/** A plan file that is gone, or whose goal another session took over, clears the state, so a ghost goal does not stay. */
async function refused(io: PlanRunIo, reason: string): Promise<{ readonly deny: string }> {
  if (reason !== GONE && reason !== TAKEN) return deny(reason)
  await io.set(() => null)
  return deny(reason === GONE ? GOAL_GONE : GOAL_TAKEN)
}

/** What a write to the goal in hand must find in its file: the owner the session last saw there. */
const guardOf = (state: PlanState): Guard => ({ owner: state.session })

/** A change the session made on its own (a tick, a dismiss) was refused: a debug record, and the goal is let go if another session took it over. */
async function noteRefused(io: PlanRunIo, reason: string, what: string): Promise<void> {
  await note(io, `${what}: ${reason}`)
  if (reason === TAKEN) await io.set(() => null)
}

/**
 * The goal in hand follows its session. The session's id changes without a session start when the person runs /clear, or resumes another
 * conversation in the same window (hooks/register-session.ts): the goal stays with the window, and its file is given the new id, as long as
 * the file still names the session that held it. If another session took it over meanwhile (Resume in its History tab) it is let go instead,
 * and the answer says so. Compaction changes no id. Never throws; nothing when there is no goal in hand.
 */
async function keepGoal(io: PlanRunIo): Promise<{ readonly deny: string } | undefined> {
  const state = io.isOn() ? await io.get() : null
  if (state === null) return undefined
  const me = await io.session()
  // An id a plan file cannot hold (the plan file never names it) is no reason to refuse a call: such a goal has no owner to move.
  if (state.session === me || !SESSION_ID.test(me)) return undefined
  const moved = await changeGoal(io.files, io.root(), state.slug, { op: 'own', session: me }, new Set<string>(), async plan => {
    await io.set(prev => (prev !== null && prev.slug === state.slug ? stateFrom(plan, state.slug, prev.startedAt, prev, []) : prev))
  }, guardOf(state))
  return moved.ok ? undefined : refused(io, moved.reason)
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
  }, guardOf(state))
  if (!done.ok) return refused(io, done.reason)
  const held = next as PlanState | null
  if (held === null) return { result: '' }
  const staff = await io.staff()
  const text = planText(held, staff)
  const line = await closingLine(io, closeDue(state, held, staff), held)
  return { result: line === undefined ? text : `${text}\n${line}` }
}

const HELD = 'All steps are ticked. The goal closes when the specialists at work hand back.'

/**
 * The line to add to a `plan` answer once every step is ticked (`closeDue`): the goal is closed here, or is held back by a specialist at work.
 * A close that is refused (the Later items could not be kept) leaves the goal open and marks it `isStuck`, so this is said once and the goal is
 * not tried again by itself; Clawd ends it with `finish`, outcome `done`.
 */
async function closingLine(io: PlanRunIo, due: ReturnType<typeof closeDue>, state: PlanState): Promise<string | undefined> {
  if (due === 'none') return undefined
  if (due === 'held') return HELD
  const closed = await close(io, state, 'done')
  if (!('deny' in closed)) return `${CLOSED} ${closed.moved}`
  await io.set(prev => (prev !== null && prev.slug === state.slug ? { ...prev, isStuck: true } : prev))
  return `All steps are ticked but the goal could not be closed (${closed.deny}). Call finish with outcome "done" to close it.`
}

/** Ends the goal: the Later items kept, the file emptied, the state cleared, the `goal_end` record written. Either how it went, or why it was refused. */
async function close(io: PlanRunIo, state: PlanState, outcome: 'done' | 'stopped'): Promise<{ readonly moved: string } | { readonly deny: string }> {
  let kept = 0
  const ended = await finishGoal(io.files, io.root(), state.slug, async later => {
    // Every put-off item is kept or the goal is not ended: a failure here is refused (and the file left as it is), never let go.
    await io.keepLater(later)
    kept = later.length
  }, () => io.set(() => null), guardOf(state))
  if (!ended.ok) return refused(io, ended.reason)
  // The goal_end record only once the finish went through, outside the plan files' queue: a failed finish and its retry end the goal once.
  try {
    await io.goalEnded({ slug: state.slug, title: state.title, ...(state.summary === undefined ? {} : { summary: state.summary }), outcome, startedAt: state.startedAt, endedAt: await io.now(), steps: state.steps })
  } catch (err) {
    await note(io, `the end of the goal could not be recorded: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { moved: kept === 0 ? 'There were no put-off items to move.' : `${kept} put-off ${kept === 1 ? 'item was' : 'items were'} moved to the project's Later list.` }
}

async function finish(io: PlanRunIo, state: PlanState, outcome: 'done' | 'stopped'): Promise<Answer> {
  const closed = await close(io, state, outcome)
  if ('deny' in closed) return closed
  return { result: `The goal "${fit(state.title, 120)}" is over (${outcome}). ${closed.moved} There is no goal in hand now.` }
}

/**
 * Clawd's call of the `plan` tool. A specialist's call is refused, and so is any call while Clawd is off. Every answer is the plan in short
 * text with its ids, or one plain sentence why not. Never throws.
 */
export async function planTool(io: PlanRunIo, agentId: string | undefined, input: Record<string, unknown>): Promise<Answer> {
  if (agentId !== undefined) return deny(DENY_SPECIALIST)
  if (!io.isOn()) return deny(DENY_OFF)
  return withNotes(io, await withDraftNote(io, await answerTo(io, input)))
}

/**
 * A linked run handed its report back, and its goal is not in this session (it was ended, or another session took it over): one line waits
 * for Clawd's next `plan` answer, the same line once however many signals come. A run that was on no plan, or did not end well, leaves none.
 * A hand-back cannot speak to Clawd itself, so he hears it in the next answer. Never throws.
 */
async function tellLost(io: PlanRunIo, run: Employee | undefined): Promise<void> {
  try {
    if (run?.stepId === undefined || run.planKey === undefined || run.mood !== 'done') return
    const line = `The specialist on step ${fit(run.stepId, 20)} finished, but its goal isn't in this session (it was ended, or taken over by another session). Its report is in the hand-back.`
    await io.notes.set(lines => (lines.includes(line) ? lines : [...lines, line]))
  } catch (err) {
    await note(io, `the loss of a hand-back could not be noted: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** The answer of a call with the lines that waited for Clawd after it, once each. Never throws. */
async function withNotes(io: PlanRunIo, answer: Answer): Promise<Answer> {
  try {
    const lines = await io.notes.get()
    if (lines.length === 0) return answer
    await io.notes.set(now => now.filter(line => !lines.includes(line)))
    const text = lines.join('\n')
    return 'result' in answer ? { result: `${answer.result}\n${text}` } : { deny: `${answer.deny}\n${text}` }
  } catch (err) {
    await note(io, `the notes for Clawd could not be given: ${err instanceof Error ? err.message : String(err)}`)
    return answer
  }
}

/**
 * The draft of this project folder, or none. One that has waited longer than `DRAFT_DAYS` is dropped here, when it is next looked at: a plan
 * nobody started for a week is no longer what the person asked for.
 */
async function liveDraft(io: PlanRunIo): Promise<PlanDraft | null> {
  const root = io.root()
  const draft = await io.draft.get(root)
  if (draft === null || (await io.now()) - draft.at <= DRAFT_MS) return draft
  await io.draft.set(root, () => null)
  return null
}

/**
 * The answer of a call, with a note of the Planner's plan after it, once: that it waits (with its steps, to start it), or that the office
 * started it by itself. On the first answer after the Planner's report. Never throws.
 */
async function withDraftNote(io: PlanRunIo, answer: Answer): Promise<Answer> {
  try {
    const draft = await liveDraft(io)
    if (draft === null || draft.isTold) return answer
    await io.draft.set(io.root(), prev => (prev === null ? prev : prev.kind === 'started' ? null : { ...prev, isTold: true }))
    const text = draft.kind === 'started' ? startedNote(draft) : draftNote(draft)
    return 'result' in answer ? { result: `${answer.result}\n${text}` } : { deny: `${answer.deny}\n${text}` }
  } catch (err) {
    await note(io, `the note of a waiting plan could not be given: ${err instanceof Error ? err.message : String(err)}`)
    return answer
  }
}

/** A `start` with a goal and no steps, while a waiting draft has that same title: the draft's steps are the call's. */
async function withDraftSteps(io: PlanRunIo, call: Extract<PlanCall, { kind: 'start' }>): Promise<{ call: Extract<PlanCall, { kind: 'start' }>; by: 'clawd' | 'planner' }> {
  if (call.steps.length > 0 || typeof call.goal !== 'string') return { call, by: 'clawd' }
  const draft = await liveDraft(io)
  return draft?.kind === 'waiting' && sameTitle(draft.title, call.goal) ? { call: { ...call, steps: draft.steps }, by: 'planner' } : { call, by: 'clawd' }
}

async function answerTo(io: PlanRunIo, input: Record<string, unknown>): Promise<Answer> {
  const parsed = parseCall(input)
  if ('error' in parsed) return deny(parsed.error)
  const call = parsed.call
  try {
    if (call.kind === 'start') { const used = await withDraftSteps(io, call); return await start(io, used.call, used.by) }
    // A goal left in the project by an earlier session (or one that Clawd's being off kept from loading) is picked up here.
    if ((await io.get()) === null) await loadPlan(io)
    const lost = await keepGoal(io)
    if (lost !== undefined) return lost
    const state = await io.get()
    if (state === null) return deny(await noGoalText(io))
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
 * to this one. A hand-back that leaves every step ticked and no specialist of the goal at work ends the goal (`closeIfComplete`). Safe to call again for the same run. Never throws.
 */
export async function settleRun(io: PlanRunIo, runId: string): Promise<void> {
  try {
    if (!io.isOn()) return
    const state = await io.get()
    const run = (await io.staff()).find(one => one.id === runId)
    if (state === null) {
      await tellLost(io, run) // a hand-back that finds no goal is not passed over in silence
      return
    }
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
    }, guardOf(state))
    if (!done.ok) {
      await noteRefused(io, done.reason, 'a step could not be ticked')
      if (done.reason === TAKEN) await tellLost(io, run) // the goal went to another session while the specialist worked
    } else await closeIfComplete(io, state)
  } catch (err) {
    await note(io, `a step could not be ticked: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** After a hand-back: the goal ends as done when every step is ticked and no specialist of it is still at work (`closeDue`). Clawd is told in the answer of his next `plan` call (`NO_GOAL`). A refused end is a debug record, and the goal stays open; his next `plan` call tries again and tells him if it fails. */
async function closeIfComplete(io: PlanRunIo, before: PlanState): Promise<void> {
  const held = await io.get()
  if (held === null || held.slug !== before.slug || closeDue(before, held, await io.staff()) !== 'close') return
  const closed = await close(io, held, 'done')
  if ('deny' in closed) await note(io, `the goal could not be closed after its last step was ticked: ${closed.deny}`)
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
    }, guardOf(state))
    if (!done.ok) await noteRefused(io, done.reason, 'a Later item could not be dismissed')
  } catch (err) {
    await note(io, `a Later item could not be dismissed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * The person sent a message: the "new" marks on the plan go (nothing is written when none is set), and the goal in hand follows the session's
 * id if /clear or a resume in the same window changed it (`keepGoal`), so the file names the right session before anything else happens.
 */
export async function clearNewMarks(io: PlanRunIo): Promise<void> {
  try {
    await keepGoal(io)
    const state = await io.get()
    if (state !== null && clearNew(state) !== state) await io.set(prev => (prev === null ? prev : clearNew(prev)))
  } catch (err) {
    await note(io, `the new marks could not be cleared: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Resume on another session's open goal (History tab): this session takes it over. The plan file is given this session's id and this session
 * holds the goal, with its steps, ticks and Later list as the file has them. It is the only way a session takes over a goal it did not start
 * (hooks/plan-run.ts `loadPlan` never does). Refused while this session has a goal in hand (one at a time) and while Clawd is off. The session
 * that held it finds its writes refused (`TAKEN`) and lets the goal go at its next call. A plan of no session (saved before plan files named
 * one) is taken the same way. Never throws.
 */
export async function takeOver(io: PlanRunIo, slug: string): Promise<{ ok: true; state: PlanState } | { ok: false; reason: string }> {
  try {
    if (!io.isOn()) return { ok: false, reason: DENY_OFF }
    const me = await io.session()
    // The goal's own file, whoever owns it now: no guard, the takeover is the change of owner. "No goal in hand" is asked inside the file queue,
    // when this takeover's turn comes, and the goal is held before the next one is asked: two quick Resumes cannot stamp one goal and hold the other.
    const done = await claimGoal(io.files, io.root(), slug, me, async () => (await io.get()) === null, HAS_GOAL, async plan => {
      const began = plan.startedAt ?? (await io.goalStartedAt(slug).catch(() => undefined)) ?? (await io.now())
      await io.set(prev => prev ?? stateFrom(plan, slug, began, null, []))
    })
    if (!done.ok) return { ok: false, reason: done.reason }
    const held = await io.get()
    return held === null || held.slug !== slug ? { ok: false, reason: HAS_GOAL } : { ok: true, state: held }
  } catch (err) {
    await note(io, `a goal could not be taken over: ${err instanceof Error ? err.message : String(err)}`)
    return { ok: false, reason: `The goal could not be taken over: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** What Resume puts in the prompt box after a takeover (never sent): the goal and the steps still open. Built from the plan's clean text. */
export function takeOverPrompt(state: PlanState): string {
  const open = state.steps.filter(step => !step.isDone).map(step => `- ${fit(step.text, 120)}`)
  return [`Please carry on with the goal "${fit(state.title, 120)}", which I took over from another session. Its open steps:`, ...open].join('\n')
}

/**
 * A specialist that carried `PLAN-DRAFT: <goal title>` handed its report back (the real hand-back, never a guessed end). Its `STEP:` lines
 * become the plan, exactly as `start` makes one, when there are two or more, no goal is in hand and the session is still in the folder the
 * Planner was hired in (`folder`); Clawd is then told once that it was started. Otherwise they are kept as a draft for that folder, one at
 * most, and Clawd is told in the answer of his next `plan` call there. A newer draft replaces the older, and so does a later report of the
 * same Planner when Clawd resumes it: that report is a newer plan, whatever it replaces. With Clawd off, nothing is made and nothing is
 * kept. Never throws.
 */
export async function receiveDraft(io: PlanRunIo, title: string, report: string, folder: string = io.root()): Promise<void> {
  try {
    if (!io.isOn()) return
    const steps = parseSteps(report)
    const goal = cleanText(title)
    if (steps.length === 0 || goal === '' || looksSecret(goal)) return
    const at = await io.now()
    if (steps.length >= 2 && folder === io.root() && 'result' in (await start(io, { goal, steps }, 'planner'))) {
      await io.draft.set(folder, () => ({ folder, title: goal, steps, at, isTold: false, kind: 'started' }))
      return
    }
    // A goal is in hand, another folder is open, or the start was refused: the steps wait for that folder.
    await io.draft.set(folder, () => ({ folder, title: goal, steps, at, isTold: false, kind: 'waiting' }))
  } catch (err) {
    await note(io, `a plan from the Planner could not be taken: ${err instanceof Error ? err.message : String(err)}`)
  }
}

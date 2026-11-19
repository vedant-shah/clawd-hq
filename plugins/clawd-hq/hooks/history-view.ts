// The History tab's content (pure), from the project's history records (hooks/history.ts), this session's books and the goal in hand: the
// goal in progress, the goals that ended (newest first, each folded to one line, opened to its totals and steps), and the work done off the plan:
// one line per run, this session's (from the books) and earlier sessions' (from the history) alike, newest first.
// panel-history.tsx draws it for the terminal and the desktop.
import type { Employee, Fx, PlanState } from '../types'
import type { PlanView } from './plan'
import { collapseRuns, runTokens } from './history'
import type { GoalEndRecord, HistoryRecord, Outcome, RunRecord, StepEnd } from './history'
import { nameLabel, ago, roleOf } from './office'
import { doneThisSession, isActive, tokensLabel } from './panel-model'

export const GOALS_SHOWN = 20
export const OTHER_SHOWN = 40

/** The History tab's folds, kept with the plan's in `Fx.folds`: closed unless named. */
export const HISTORY_FOLD = {
  goal: (slug: string, at: number) => `history|goal:${slug}:${at}`,
  goalsOlder: 'history|goals-older',
  other: 'history|other',
  otherOlder: 'history|other-older',
  artifacts: 'history|artifacts',
  artifactsOlder: 'history|artifacts-older',
} as const

/** How a step of an ended goal is marked, and what it says at its right. */
export type StepMark = 'done' | 'failed' | 'open'
export type StepLine = { id: string; text: string; mark: StepMark; choices: string[]; note?: { text: string; tone: 'amber' | 'red' | 'dim' } }
export type GoalLine = {
  /** Its fold's key, and the parts of it its buttons are keyed by. */
  fold: string; slug: string; at: number
  title: string; summary?: string; isSetAside: boolean; isOpen: boolean
  /** "4 steps · 5 agents · 38m · 210K tokens", or for a goal set aside "2 of 5 steps done · …". */
  stats: string
  steps: StepLine[]
  pages: Array<{ url: string; title: string }>
  /** What Resume puts in the prompt box, for a goal set aside. */
  resume?: string
  /** A goal another session left open (or a plan file of no session): it is listed with its steps, not as a goal that ended. */
  isElsewhere?: true
  /** Resume takes this open goal over for this session (hooks/plan-run.ts `takeOver`): shown only with Clawd on and no goal in hand. */
  canTakeOver?: boolean
}
export type OtherLine = { id: string; name: string; task: string; outcome: Outcome; startedAt: number; at: number }
export type HistoryLayout = {
  inProgress?: { title: string; done: number; total: number }
  /** Goals other sessions left open in this folder, newest first (hooks/register-panes.ts lists them from the plan files). */
  open: GoalLine[]
  goals: GoalLine[]; olderGoals: number; isGoalsOlderOpen: boolean
  other: { count: number; isOpen: boolean; lines: OtherLine[]; older: number; isOlderOpen: boolean }
  isEmpty: boolean
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function stepLine(step: StepEnd): StepLine {
  const note = step.isDone
    ? step.retries > 0 ? { text: plural(step.retries, 'retry', 'retries'), tone: 'amber' as const } : undefined
    : step.lastOutcome === 'failed' ? { text: 'failed', tone: 'red' as const }
      : step.lastOutcome === 'stopped' ? { text: 'stopped', tone: 'dim' as const }
        : step.lastOutcome === 'lost' ? { text: 'lost contact', tone: 'dim' as const } : undefined
  const mark: StepMark = step.isDone ? 'done' : step.lastOutcome === 'failed' ? 'failed' : 'open'
  return { id: step.id, text: step.text, mark, choices: step.choices, ...(note === undefined ? {} : { note }) }
}

/** The most Resume puts in the prompt box. */
const RESUME_CHARS = 2_000

/**
 * Resume on a goal set aside: asks Clawd to start it again with the steps it did not finish. Fills the prompt box; never sends. Built only from
 * the record's clean values (one line each, read back by `cleanRecord`), and cut, at a line, to RESUME_CHARS.
 */
export function resumePrompt(end: GoalEndRecord): string {
  const lines = [`Please start the goal "${end.title}" again with its unfinished steps:`, ...end.steps.filter(step => !step.isDone).map(step => `- ${step.text}`)]
  return lines.reduce((out, line) => (out.length + 1 + line.length > RESUME_CHARS ? out : `${out}\n${line}`), lines[0]!.slice(0, RESUME_CHARS))
}

function goalLine(end: GoalEndRecord, runs: readonly RunRecord[], folds: ReadonlySet<string>, canResume: boolean): GoalLine {
  const fold = HISTORY_FOLD.goal(end.goal ?? '', end.at)
  // The tokens as every tab counts them: kept on the goal_end since it was written there; added up from its runs for an older one.
  const tokens = end.tokens ?? runs.filter(r => r.goal === end.goal && r.at >= end.startedAt && r.at <= end.at).reduce((n, r) => n + runTokens(r), 0)
  const isSetAside = end.outcome === 'stopped'
  const isResumable = isSetAside && canResume && end.steps.some(step => !step.isDone)
  const steps = isSetAside ? `${end.stepsDone} of ${plural(end.stepsTotal, 'step')} done` : plural(end.stepsTotal, 'step')
  const stats = [steps, plural(end.runs, 'agent'), ago(end.workMs), tokens > 0 ? `${tokensLabel(tokens)} tokens` : undefined].filter(Boolean).join(' · ')
  return {
    fold, slug: end.goal ?? '', at: end.at, title: end.title, ...(end.summary ? { summary: end.summary } : {}), isSetAside, isOpen: folds.has(fold),
    stats, steps: end.steps.map(stepLine), pages: end.artifacts ?? [], ...(isResumable ? { resume: resumePrompt(end) } : {}),
  }
}

/** A plan file in the folder that this session does not own: its slug and view as `loadGoals` gives them (hooks/plan-io.ts). */
export type OpenGoal = { slug: string; plan: PlanView; mtimeMs: number }

/**
 * Another session's open goal as a line of its own: its steps with their ticks and choices, and a Resume that takes it over for this session.
 * DECIDED: it is listed apart from the goals that ended, never as in progress (that is this session's goal), and `at` is when it began (the
 * plan file's `started` line, else the file's time) so its fold key is stable.
 */
function openLine(one: OpenGoal, folds: ReadonlySet<string>, canResume: boolean): GoalLine {
  const at = one.plan.startedAt ?? one.mtimeMs
  const fold = HISTORY_FOLD.goal(one.slug, at)
  const done = one.plan.steps.filter(step => step.isDone).length
  const steps: StepLine[] = one.plan.steps.map(step => ({ id: step.id, text: step.text, mark: step.isDone ? 'done' : 'open', choices: step.choices }))
  return {
    fold, slug: one.slug, at, title: one.plan.title, ...(one.plan.summary === undefined ? {} : { summary: one.plan.summary }), isSetAside: false, isOpen: folds.has(fold),
    stats: `${done} of ${plural(one.plan.steps.length, 'step')} done`, steps, pages: [], isElsewhere: true, canTakeOver: canResume,
  }
}

/** A run's name as the office shows it: the name it was given, else its type's role. */
const nameOf = (name: string | undefined, type: string) => (name ? nameLabel(name) : '') || roleOf(type).title
const OUTCOMES: readonly string[] = ['done', 'failed', 'lost', 'stopped']

/** One of this session's finished runs as its one line, as an earlier session's run reads. */
const lineOfRun = (one: Employee): OtherLine => ({
  id: `${one.id}@${one.startedAt}`, name: nameOf(one.name, one.type), task: one.description || one.type,
  outcome: (OUTCOMES.includes(one.mood) ? one.mood : 'lost') as Outcome, startedAt: one.startedAt, at: one.endedAt ?? one.startedAt,
})

/** What the History tab derives from the records alone (the runs, one record each, and the goals that ended), kept while the list is the same. */
type Prepared = { runs: RunRecord[]; ends: GoalEndRecord[] }
const preparedFor = new WeakMap<readonly HistoryRecord[], Prepared>()
export function prepared(records: readonly HistoryRecord[]): Prepared {
  const known = preparedFor.get(records)
  if (known !== undefined) return known
  const made = {
    runs: collapseRuns(records),
    // One record per goal that ended (the same goal ended once; a line read twice counts once), newest first.
    ends: [...new Map(records.filter((r): r is GoalEndRecord => r.kind === 'goal_end').map(r => [`${r.goal}@${r.at}`, r])).values()].sort((a, b) => b.at - a.at),
  }
  preparedFor.set(records, made)
  return made
}

export type HistoryInput = {
  records: readonly HistoryRecord[]; staff: Employee[]; sessionStart: number; plan: PlanState | null; isOn: boolean; folds: Fx['folds']
  /** The plan files of this folder that another session owns, or no session (hooks/register-panes.ts). Shown only while Clawd runs the chat. */
  openGoals?: readonly OpenGoal[]
}

export function historyLayout(input: HistoryInput): HistoryLayout {
  const folds = new Set(input.folds ?? [])
  const { runs, ends } = prepared(input.records)
  const isGoalsOlderOpen = folds.has(HISTORY_FOLD.goalsOlder)
  // Resume asks Clawd to start a goal: only while he runs the chat and no goal is in hand (one goal at a time).
  const canResume = input.isOn && input.plan === null
  const goals = ends.slice(0, isGoalsOlderOpen ? ends.length : GOALS_SHOWN).map(end => goalLine(end, runs, folds, canResume))
  // Other work, one line per run off the plan (a pair-up's or a council's members each their own): this session's finished runs from the books
  // (their record may not be written yet), and every other run from the history; one from before a /clear is an earlier run.
  const session = doneThisSession(input.staff, input.sessionStart).filter(one => one.planKey === undefined).map(lineOfRun)
  // A run among this session's lines is that run (an id and a start: a resumed agent's earlier run is another); one at work now is on the floor.
  const drawn = new Set(session.map(line => line.id))
  const atWork = new Set(input.staff.filter(isActive).map(one => one.id))
  const earlier = runs.filter(r => r.goal === undefined && !drawn.has(`${r.run}@${r.startedAt}`) && !atWork.has(r.run))
    .map((r): OtherLine => ({ id: `${r.run}@${r.startedAt}`, name: nameOf(r.name, r.type), task: r.task, outcome: r.outcome, startedAt: r.startedAt, at: r.endedAt }))
  const all = [...session, ...earlier].sort((a, b) => b.at - a.at)
  const count = all.length
  const isOlderOpen = folds.has(HISTORY_FOLD.otherOlder)
  const room = isOlderOpen ? count : OTHER_SHOWN
  const plan = input.isOn ? input.plan : null
  // Open goals of other sessions: never the goal in hand, and none with Clawd off (a goal is Clawd's, as the plan is).
  const open = !input.isOn ? [] : (input.openGoals ?? []).filter(one => one.slug !== input.plan?.slug)
    .map(one => openLine(one, folds, canResume)).sort((a, b) => b.at - a.at)
  return {
    ...(plan === null ? {} : { inProgress: { title: plan.title, done: plan.steps.filter(s => s.isDone).length, total: plan.steps.length } }),
    open, goals, olderGoals: Math.max(0, ends.length - GOALS_SHOWN), isGoalsOlderOpen,
    other: {
      count, isOpen: folds.has(HISTORY_FOLD.other), lines: all.slice(0, room),
      older: Math.max(0, count - OTHER_SHOWN), isOlderOpen,
    },
    isEmpty: ends.length === 0 && count === 0 && open.length === 0,
  }
}

/** The empty tab: what a layout that could not be made falls back to. */
const EMPTY_LAYOUT: HistoryLayout = { open: [], goals: [], olderGoals: 0, isGoalsOlderOpen: false, other: { count: 0, isOpen: false, lines: [], older: 0, isOlderOpen: false }, isEmpty: true }

/** The layout, or (a record no check foresaw broke it) the empty tab and a word about why, so the tab never fails to draw. */
export function safeHistoryLayout(input: HistoryInput, onError: (why: string) => void): HistoryLayout {
  try {
    return historyLayout(input)
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err))
    return { ...EMPTY_LAYOUT, ...(input.isOn && input.plan !== null ? { inProgress: { title: input.plan.title, done: input.plan.steps.filter(s => s.isDone).length, total: input.plan.steps.length } } : {}) }
  }
}

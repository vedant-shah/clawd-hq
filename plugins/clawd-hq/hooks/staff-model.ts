// How a specialist's run starts, spends and ends, as pure functions over one employee.
import type { AgentStatus } from 'claude-code'
import type { Boss, EndedBy, Employee, Mood } from '../types'
import { ago } from './office'
import { DEMO, isActive } from './panel-model'
import { withProgress, withWords } from './steps'
import type { StepReport } from './steps'

export type StepUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** The books hold this many specialists; the longest-gone finishers leave first. The Log lists up to 40, so keep more. */
export const MAX_STAFF = 60

/** Puts `fresh` on the books. One already there (a tool call can land before the spawn answers) keeps its progress and takes the spawn's facts. */
export function hire(list: Employee[], fresh: Employee): Employee[] {
  if (list.some(e => e.id === fresh.id)) {
    return list.map(e => (e.id === fresh.id ? { ...e, type: fresh.type, description: fresh.description || e.description, name: fresh.name ?? e.name } : e))
  }
  const all = [...list, fresh]
  // Over the cap, the longest-gone finishers leave first; a running agent is never dropped.
  let extra = all.length - MAX_STAFF
  return extra <= 0 ? all : all.filter(e => (extra > 0 && !isActive(e) ? (extra--, false) : true))
}

/** A run's own progress report (hooks/steps.ts): none at its start, none once it ends. */
const NO_PROGRESS = { stepDone: undefined, stepTotal: undefined, stepNote: undefined, stepBy: undefined }

/** An engine status counts as an end only after this long without a sign of life. */
export const QUIET_MS = 15_000
/** A specialist the engine calls running, silent this long, has lost contact (unless the engine says it waits). */
export const STALE_MS = 30 * 60_000

/** How long it has been since the last sign of life (for one never heard from since, since it started). */
export const quietFor = (one: Employee, now: number) => now - (one.lastSeen ?? one.startedAt)

/** A sign of life: it was heard from at `now`. */
export const touch = (one: Employee, now: number): Employee => ({ ...one, lastSeen: now })

/**
 * A specialist that runs again after an end. If the end was a guess (the engine list, or too long quiet) the same
 * run goes on, clock and counters kept; after a real stop signal it is a new run with its own clock, tools and tokens.
 */
export function restart(one: Employee, now: number, tick: number): Employee {
  if (isActive(one)) return one
  if (one.endedBy === 'engine' || one.endedBy === 'stale') {
    return { ...one, mood: 'working', endedAt: undefined, doneTick: undefined, endedBy: undefined, lastSeen: now }
  }
  return {
    ...one, mood: 'working', activity: undefined, said: undefined, report: undefined, ...NO_PROGRESS, tools: 0, tokens: 0, outTokens: 0, peakInput: 0, context: 0,
    startedAt: now, endedAt: undefined, doneTick: undefined, endedBy: undefined, joinedTick: tick, lastSeen: now,
  }
}

/** Ends the run. Lost contact is no cheer and no win, so it leaves no tick for the cheering. */
export function endRun(one: Employee, mood: Mood, how: EndedBy, now: number, tick: number): Employee {
  const cheer = mood === 'lost' ? {} : { doneTick: tick }
  return { ...one, ...cheer, mood, activity: undefined, said: undefined, ...NO_PROGRESS, endedAt: now, endedBy: how }
}

/** Clawd's card after a run ended with a win or a failure: proud or sorry for a while, with who it was and the new count. A stop on purpose changes nothing. */
export const finishedBoss = (b: Boss, mood: Mood, t: number, label: string): Boss => {
  if (mood === 'stopped') return b
  return mood === 'done'
    ? { ...b, proudUntil: t + 10, oopsUntil: 0, lastTitle: label, wins: b.wins + 1 }
    : { ...b, oopsUntil: t + 10, proudUntil: 0, lastTitle: label, fails: b.fails + 1 }
}

/** The toast for a run that ended with a win, a stop on purpose, or a failure. */
export const finishedText = (mood: Mood, prop: string, label: string, e: Employee, now: number): string => {
  if (mood === 'stopped') return `${label} stopped: ${e.description || e.type}`
  return mood === 'done'
    ? `${prop} ${label} finished: ${e.description || e.type} (${ago(now - e.startedAt)}, ${e.tools} tools)`
    : `🤕 ${label} could not finish: ${e.description || e.type}`
}

/** A progress report (the step tool's) reaches a specialist only while its run is going; one that ended meanwhile is left as it was. A report is a sign of life. */
export const withReport = (one: Employee, r: StepReport, now: number): Employee => (isActive(one) ? touch(withProgress(one, r), now) : one)

/** A record keeps the newest this many of the choices its specialist reported. */
export const MAX_CHOICES = 5

const sameChoice = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase()

/** The specialist with these choices added to its record: the same one said again (any case or spacing) is kept once, the newest five stay. No new choice, no change. */
export function withChoices(one: Employee, said: readonly string[]): Employee {
  const added = said.filter(text => text.trim() !== '')
  const merged = added.reduce<string[]>((list, text) => (list.some(old => sameChoice(old, text)) ? list : [...list, text]), one.choices ?? [])
  return merged.length === (one.choices ?? []).length ? one : { ...one, choices: merged.slice(-MAX_CHOICES) }
}

/** A tool call: the specialist is at work, one tool more, and the sentence says on what. One still arriving stays arriving. */
export const withTool = (one: Employee, activity: string): Employee =>
  ({ ...one, mood: one.mood === 'arriving' ? 'arriving' : 'working', activity, tools: one.tools + 1 })

/** What the specialist said in its last step. Its words are newer than any note it reported before, so the note goes; the count stays, or follows a "Step N of M" in the words. */
export const withSaid = (one: Employee, said: string): Employee => withWords({ ...one, said, stepNote: undefined }, said)

/**
 * One model request's cost. A request re-reads the whole prompt, so adding every request's context up counts
 * the cached prompt once per step. The figure is the run's largest request input plus all output, which a compaction cannot lower.
 */
export function withStep(one: Employee, u: StepUsage, model: string, now: number): Employee {
  const input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
  const output = u.output_tokens || 0
  const [peakInput, outTokens] = [Math.max(one.peakInput ?? 0, input), (one.outTokens ?? 0) + output]
  return { ...one, model: model || one.model, context: input + output, peakInput, outTokens, tokens: peakInput + outTokens, lastSeen: now }
}

/** How the engine's status for an agent ends its time at a desk: undefined while it is still going. A killed run was stopped on purpose, not failed. */
export function endOfStatus(status: AgentStatus): Mood | undefined {
  if (status === 'completed' || status === 'idle') return 'done'
  if (status === 'killed') return 'stopped'
  return status === 'failed' ? 'failed' : undefined
}

/** The engine's status moved: a move to a running one is a sign of life, a move to an ended one is not. */
export function markEngine(one: Employee, status: AgentStatus, now: number): Employee {
  return { ...one, engine: status, lastSeen: endOfStatus(status) ? one.lastSeen : now }
}

/**
 * Whether the reconcile should end this run, given the engine's status for it (undefined: not listed) and the time.
 * Only silence ends a run: the engine's word counts once QUIET_MS has passed without a sign of life, and a run
 * the engine still calls running is lost after STALE_MS. A waiting one is never lost; demos are never judged.
 */
export function verdict(one: Employee, status: AgentStatus | undefined, now: number): { mood: Mood; how: EndedBy } | undefined {
  if (!isActive(one) || one.id.startsWith(DEMO)) return undefined
  const quiet = quietFor(one, now)
  const ended = status === undefined ? 'done' : endOfStatus(status)
  if (ended) return quiet > QUIET_MS ? { mood: ended, how: 'engine' } : undefined
  return status !== 'waiting' && quiet > STALE_MS ? { mood: 'lost', how: 'stale' } : undefined
}

// How a specialist's run starts, spends and ends, as pure functions over one employee.
import type { AgentStatus } from 'claude-code'
import type { EndedBy, Employee, Mood } from '../types'
import { DEMO, isActive } from './panel-model'

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
    return list.map(e => (e.id === fresh.id ? { ...e, type: fresh.type, description: fresh.description || e.description, prompt: fresh.prompt || e.prompt } : e))
  }
  const all = [...list, fresh]
  // Over the cap, the longest-gone finishers leave first; a running agent is never dropped.
  let extra = all.length - MAX_STAFF
  return extra <= 0 ? all : all.filter(e => (extra > 0 && !isActive(e) ? (extra--, false) : true))
}

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
    ...one, mood: 'working', activity: undefined, tools: 0, tokens: 0, outTokens: 0, peakInput: 0, context: 0,
    startedAt: now, endedAt: undefined, doneTick: undefined, endedBy: undefined, joinedTick: tick, lastSeen: now,
  }
}

/** Ends the run. Lost contact is no cheer and no win, so it leaves no tick for the cheering. */
export function endRun(one: Employee, mood: Mood, how: EndedBy, now: number, tick: number): Employee {
  const cheer = mood === 'lost' ? {} : { doneTick: tick }
  return { ...one, ...cheer, mood, activity: undefined, endedAt: now, endedBy: how }
}

/** A tool call: the specialist is at work, one tool more, and the sentence says on what. One still arriving stays arriving. */
export const withTool = (one: Employee, activity: string): Employee =>
  ({ ...one, mood: one.mood === 'arriving' ? 'arriving' : 'working', activity, tools: one.tools + 1 })

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

/** How the engine's status for an agent ends its time at a desk: undefined while it is still going. */
export function endOfStatus(status: AgentStatus): Mood | undefined {
  if (status === 'completed' || status === 'idle') return 'done'
  return status === 'failed' || status === 'killed' ? 'failed' : undefined
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

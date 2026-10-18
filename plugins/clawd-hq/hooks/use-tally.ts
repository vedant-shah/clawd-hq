// A running tally of agent and skill use, per project and per session: names and counts only, kept in the plugin's own store as it happens.
// Setup adds it to past use for the sessions whose files it could not read (hooks/usage-history.ts). No `$` here: the store comes in as closures.
import type { OnboardIo } from './onboard-types'
import { EMPTY, countUse } from './usage-count'
import type { Counts } from './usage-count'

export type TallyIo = Pick<OnboardIo, 'get' | 'set'>
/** Counts by session id. */
export type SessionTally = Readonly<Record<string, Counts>>

/** The most sessions kept; the oldest go first. */
export const MAX_SESSIONS = 100
const MAX_NAME_CHARS = 100

export const tallyKey = (folder: string) => `tally:${folder}`

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

function cleanCounts(raw: unknown): Record<string, number> {
  if (typeof raw !== 'object' || raw === null) return {}
  return Object.fromEntries(Object.entries(raw).filter(([name, n]) => name.length <= MAX_NAME_CHARS && isCount(n)).map(([name, n]) => [name, Math.floor(n as number)]))
}

/** The stored tally as data we trust: only sessions holding agent and skill counts survive, whatever was saved. */
export function cleanTally(raw: unknown): SessionTally {
  if (typeof raw !== 'object' || raw === null) return {}
  return Object.fromEntries(Object.entries(raw).map(([session, counts]) => {
    const { agents, skills } = (typeof counts === 'object' && counts !== null ? counts : {}) as { agents?: unknown; skills?: unknown }
    return [session, { agents: cleanCounts(agents), skills: cleanCounts(skills) }] as const
  }))
}

/** The tally after one tool call: the same object when the call is not an agent or skill use. The session moves to the newest end and the oldest are dropped past 100. */
export function noted(tally: SessionTally, session: string, tool: unknown, input: unknown): SessionTally {
  const before = tally[session] ?? EMPTY
  const after = countUse(before, tool, input)
  if (after === before) return tally
  const { [session]: _gone, ...others } = tally
  const kept = Object.entries({ ...others, [session]: after }).slice(-MAX_SESSIONS)
  return Object.fromEntries(kept)
}

export async function savedTally(io: TallyIo, folder: string): Promise<SessionTally> {
  return cleanTally(await io.get<unknown>(tallyKey(folder)).then(v => v, () => undefined))
}

let queue: Promise<void> = Promise.resolve()

/**
 * Records one tool call. Calls are written one after another, so several agents started together are all counted.
 * A call that is not an agent or skill use touches nothing; a store that fails loses that count and never throws.
 */
export function recordUse(io: TallyIo, folder: string, session: string, tool: unknown, input: unknown): Promise<void> {
  const step = async () => {
    // A read that fails writes nothing: an empty tally written over the real one would lose it.
    const before = cleanTally(await io.get<unknown>(tallyKey(folder)))
    const after = noted(before, session, tool, input)
    if (after !== before) await io.set(tallyKey(folder), after)
  }
  queue = queue.then(step).catch(() => undefined)
  return queue
}

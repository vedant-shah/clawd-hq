// Running the scout: starting it, waiting for its picks, and answering each call it makes. No `$`: the host's calls come in as closures.
import { TEAM_TOOL } from './constants'
import type { ScoutCheck, ScoutReport } from './onboard-types'
import type { After, ScoutBox } from './scout-box'
import { guardScout } from './scout-guard'
import type { RealIo } from './scout-guard'

/** The two things starting a scout needs from the host: start it (its id, or `undefined` when it would not start), and a timer. */
export type ScoutHost = { readonly spawn: (brief: string) => Promise<string | undefined>; readonly after: After }

const CLOSED_DENY = 'Refused by Clawd HQ: the scout\'s work is finished.'
/** What stands in for the guard when the hook holding it fails: the scout's call is refused, never let through unchecked. */
export const SCOUT_CRASH_DENY = 'Refused by Clawd HQ: that call could not be checked.'
/** The agent type a start asks for, in the event's spelling or the Agent tool's own (a start the plugin makes itself can reach a hook as either). */
export const spawnTypeOf = (e: object): unknown => (e as { subagentType?: unknown }).subagentType ?? (e as { subagent_type?: unknown }).subagent_type
/** What the pick tool says to anyone but the scout. */
export const NOT_SCOUT_DENY = 'Only the Clawd HQ scout uses this tool, and the plugin starts it itself during setup.'
const TAKEN = 'Your team is noted. You are done: reply with the single word "done" and stop.'

/** Starts the scout and waits for its picks; `undefined` when it could not start, ran out of time, or ended with nothing the check accepted. */
export async function runScout(box: ScoutBox, host: ScoutHost, brief: string, check: ScoutCheck, timeoutMs: number): Promise<ScoutReport | undefined> {
  box.begin(check)
  const id = await host.spawn(brief).catch(() => undefined)
  if (id === undefined) return undefined
  box.mark(id)
  return box.wait(id, timeoutMs, host.after)
}

/** What a call of the scout's is answered with: refused, answered here (its picks), or run with these fields set over its own. */
export type ScoutAnswer = { readonly deny: string } | { readonly result: string } | { readonly run: Readonly<Record<string, unknown>> }

/** The scout's call, judged by the guard and the mailbox. Only calls from a scout come here. */
export async function scoutCall(box: ScoutBox, io: RealIo, folder: string, id: string, tool: string, input: Record<string, unknown>): Promise<ScoutAnswer> {
  if (box.isClosed(id)) return { deny: CLOSED_DENY }
  if (tool === TEAM_TOOL) {
    const sent = box.deliver(id, input)
    return 'problem' in sent ? { deny: sent.problem } : { result: TAKEN }
  }
  const verdict = await guardScout(io, tool, input, folder)
  if ('deny' in verdict) return verdict
  if (verdict.read !== undefined) box.noteRead(id, verdict.read)
  return { run: verdict.run }
}

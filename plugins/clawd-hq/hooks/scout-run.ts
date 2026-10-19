// Running the scout: starting it, waiting for its picks, stopping it when it is given up on, and answering each call it makes.
// No `$`: the host's calls come in as closures.
import { TEAM_TOOL } from './constants'
import type { ScoutCheck, ScoutReport } from './onboard-types'
import type { After, ScoutBox } from './scout-box'
import { guardScout } from './scout-guard'
import type { RealIo } from './scout-guard'
import { SCOUT_TYPE } from './scout-spec'

/** What starting a scout asks for. */
export type ScoutStart = { readonly subagentType: string; readonly description: string; readonly prompt: string }
/** The host's calls a scout needs: start it, list the agents, stop one, and a timer. */
export type ScoutHost = {
  readonly spawn: (start: ScoutStart) => Promise<{ readonly agentId?: string; readonly deny?: string }>
  readonly list: () => Promise<readonly { readonly id: string; readonly type: string }[]>
  readonly stop: (id: string) => Promise<unknown>
  readonly after: After
}

const CLOSED_DENY = 'Refused by Clawd HQ: the scout\'s work is finished.'
/** What stands in for the guard when the hook holding it fails: the scout's call is refused, never let through unchecked. */
export const SCOUT_CRASH_DENY = 'Refused by Clawd HQ: that call could not be checked.'
/** The agent type a start asks for, in the event's spelling or the Agent tool's own (a start the plugin makes itself can reach a hook as either). */
export const spawnTypeOf = (e: object): unknown => (e as { subagentType?: unknown }).subagentType ?? (e as { subagent_type?: unknown }).subagent_type
/** What the pick tool says to anyone but the scout. */
export const NOT_SCOUT_DENY = 'Only the Clawd HQ scout uses this tool, and the plugin starts it itself during setup.'
const TAKEN = 'Your team is noted. You are done: reply with the single word "done" and stop.'

/** The started scout's id: the one the start gave, else the newest scout the engine lists that is not known yet. `undefined` when it would not start. */
async function startedId(box: ScoutBox, host: ScoutHost, prompt: string): Promise<string | undefined> {
  const started = await host.spawn({ subagentType: SCOUT_TYPE, description: 'Look around the project', prompt }).catch(() => undefined)
  if (started === undefined || started.deny !== undefined) return undefined
  if (started.agentId !== undefined) return started.agentId
  const listed = await host.list().catch(() => [])
  return listed.find(a => a.type === SCOUT_TYPE && !box.isScout(a.id))?.id
}

/**
 * Starts the scout and waits for its picks; `undefined` when it could not start, ran out of time, or ended with nothing the check accepted.
 * A scout given up on is stopped, so it does not run on and spend; a stop that fails changes nothing.
 */
export async function runScout(box: ScoutBox, host: ScoutHost, brief: string, check: ScoutCheck, timeoutMs: number): Promise<ScoutReport | undefined> {
  box.begin(check)
  const id = await startedId(box, host, brief)
  if (id === undefined) return undefined
  box.mark(id)
  const report = await box.wait(id, timeoutMs, host.after)
  if (report === undefined) await host.stop(id).catch(() => undefined)
  return report
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

/** What the route asks the host: where a path really lands, whether an id is a hire on the books, and what type the engine lists an id as. */
export type RouteIo = RealIo & {
  readonly isHired: (id: string) => Promise<boolean>
  readonly typeOf: (id: string) => Promise<string | undefined>
}

/** Whether an id is the scout: marked, or, when it is no hire on the books, listed by the engine under the scout's type (then it is marked). */
async function isScoutId(box: ScoutBox, io: RouteIo, id: string): Promise<boolean> {
  if (box.isScout(id)) return true
  if (await io.isHired(id)) return false
  if ((await io.typeOf(id).catch(() => undefined)) !== SCOUT_TYPE) return false
  box.mark(id)
  return true
}

/**
 * Every tool call goes through here first. A scout's is answered (or has its fields set); the pick tool is turned away from anyone
 * else; `undefined` means the call is not the scout's and goes on as before. A scout is known from its very first call, marked or not.
 */
export async function scoutRoute(box: ScoutBox, io: RouteIo, folder: string, id: string | undefined, tool: string, input: Record<string, unknown>): Promise<ScoutAnswer | undefined> {
  if (id !== undefined && (await isScoutId(box, io, id))) return scoutCall(box, io, folder, id, tool, input)
  return tool === TEAM_TOOL ? { deny: NOT_SCOUT_DENY } : undefined
}

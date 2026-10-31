// Running the scout: starting it, reading its picks from its final answer, and stopping it when it is given up on.
// The plugin starts the scout from its own timer, so in Claude Code none of the plugin's hooks run inside the scout: nothing
// here waits on one. The transcript is looked at every few seconds until it holds the team block, the scout has ended, or
// time is up. No `$`: the host's calls come in as closures.
import type { ScoutResult } from './onboard-types'
import { scoutReport } from './scout-answer'
import type { ScoutMessage } from './scout-answer'
import { isClassifierRefusal } from './scout-handoff'
import { looksSecret } from './scout-pick'
import { SCOUT_SPEC, SCOUT_TYPE } from './scout-spec'

// The hand-off to Clawd, for register.tsx to reach through this module's one import line.
export { askClawd, handScoutSpawn, scoutHandoff } from './scout-handoff'

/** How often the scout's transcript is looked at. */
export const POLL_MS = 2_000
/** The engine's reason a start failed is kept to this many characters. */
const REASON_CHARS = 200
/** The engine's word for an agent that will not answer any more. */
const ENDED: ReadonlySet<string> = new Set(['completed', 'failed', 'killed'])

type Timer = { readonly cancel: () => void }
/** What starting a scout asks for. */
export type ScoutStart = { readonly subagentType: string; readonly description: string; readonly prompt: string }
/** The host's calls a scout needs: start it, list the agents, read its transcript, stop it, and a timer. */
export type ScoutHost = {
  readonly spawn: (start: ScoutStart) => Promise<{ readonly agentId?: string; readonly deny?: string }>
  readonly list: () => Promise<readonly { readonly id: string; readonly type: string; readonly status?: string }[]>
  /** The engine's version, named in the note when the scout could not start. */
  readonly version: () => Promise<string>
  /** The scout's messages so far; anything but a list (a refusal) is no answer yet. */
  readonly messages: (id: string) => Promise<unknown>
  readonly stop: (id: string) => Promise<unknown>
  readonly after: (ms: number, fn: () => void) => Timer
  /** Has Clawd hire the scout with this brief (auto mode refused the plugin's own start): his scout's id, or `undefined` when none came in time. */
  readonly askClawd: (brief: string) => Promise<string | undefined>
}

/** The agent type a start asks for, in the event's spelling or the Agent tool's own (a start the plugin makes itself can reach a hook as either). */
export const spawnTypeOf = (e: object): unknown => (e as { subagentType?: unknown }).subagentType ?? (e as { subagent_type?: unknown }).subagent_type

/** The ids of the scouts the engine lists now; a list that fails is none. */
const scoutIds = async (host: ScoutHost) => new Set((await host.list().catch(() => [])).filter(a => a.type === SCOUT_TYPE).map(a => a.id))

/** The engine's words as one short line, or a plain stand-in when they look like they hold a secret. */
function reasonLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (looksSecret(line)) return 'the engine\'s words are left out, as they looked like they held a secret'
  return line.length > REASON_CHARS ? `${line.slice(0, REASON_CHARS - 1)}…` : line
}

/**
 * The started scout's id: the one the start gave, else the newest running scout the engine lists that was not there before this
 * start (never an ended or older one). Else why it did not start, in the engine's own words where it gave any.
 */
async function startedId(host: ScoutHost, prompt: string): Promise<{ readonly id: string } | { readonly reason: string }> {
  const before = await scoutIds(host)
  const started = await host.spawn({ subagentType: SCOUT_TYPE, description: 'Look around the project', prompt })
    .catch((err: unknown): { readonly agentId?: string; readonly deny?: string } => ({ deny: err instanceof Error ? err.message : String(err) }))
  if (started.deny !== undefined) return { reason: reasonLine(started.deny) }
  if (started.agentId !== undefined) return { id: started.agentId }
  const listed = await host.list().catch(() => [])
  const id = listed.filter(a => a.type === SCOUT_TYPE && !before.has(a.id) && !ENDED.has(a.status ?? '')).at(-1)?.id
  return id === undefined ? { reason: 'no agent id came back and no new scout was listed' } : { id }
}

/**
 * The scout's id: started by the plugin, or, when auto mode refused that start (its classifier judges only what a model asks for),
 * hired by Clawd with the Agent tool on his next turn. Else why there is none, for the note.
 */
async function startedOrHired(host: ScoutHost, brief: string): Promise<{ readonly id: string } | { readonly why: string }> {
  const started = await startedId(host, brief)
  if ('id' in started) return started
  const hired = isClassifierRefusal(started.reason) ? await host.askClawd(brief).catch(() => undefined) : undefined
  if (hired !== undefined) return { id: hired }
  const either = isClassifierRefusal(started.reason) ? '; Clawd did not hire it in time either' : ''
  return { why: `The scout could not start: ${started.reason} (${await startContext(host)})${either}` }
}

/** The engine version and the scout's own settings, for the note on a start that failed. */
async function startContext(host: ScoutHost): Promise<string> {
  const version = await host.version().catch(() => 'unknown')
  const { model, tools = [], permissionMode, disallowedTools = [] } = SCOUT_SPEC
  return `engine ${version}; scout: ${model}, tools ${tools.join(', ')}, permissionMode ${permissionMode}, ${disallowedTools.length} tools withheld`
}

const pause = (host: ScoutHost) => new Promise<void>(done => { host.after(POLL_MS, done) })

/** Whether the engine says the scout is done: listed as ended, or listed no more. A list that fails says nothing. */
async function hasEnded(host: ScoutHost, id: string): Promise<boolean> {
  const listed = await host.list().catch(() => undefined)
  const one = listed?.find(a => a.id === id)
  return listed !== undefined && (one === undefined || ENDED.has(one.status ?? ''))
}

/** The scout's report once its transcript holds a team block; `undefined` while it does not (or cannot be read). */
async function answerOf(host: ScoutHost, id: string) {
  const said = await host.messages(id).catch(() => undefined)
  return Array.isArray(said) ? scoutReport(said as readonly ScoutMessage[]) : undefined
}

/**
 * Starts the scout and reads its picks from its final answer, or says why there are none. A scout given up on is stopped,
 * so it does not run on and spend; a stop that fails changes nothing.
 */
export async function runScout(host: ScoutHost, brief: string, timeoutMs: number): Promise<ScoutResult> {
  const started = await startedOrHired(host, brief)
  if ('why' in started) return started
  const { id } = started
  for (let waited = 0; waited < timeoutMs; waited += POLL_MS) {
    await pause(host)
    const ended = await hasEnded(host, id) // asked first, so an answer written just before the end still counts
    const report = await answerOf(host, id)
    if (report !== undefined) return report
    if (ended) return { why: 'The scout ended without a team list in its answer.' }
  }
  await host.stop(id).catch(() => undefined)
  return { why: `The scout gave no team list within ${Math.round(timeoutMs / 1000)} seconds, so it was stopped.` }
}

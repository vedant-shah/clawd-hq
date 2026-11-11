// When the plugin cannot start the scout itself, Clawd hires it. In auto mode the classifier judges an action by the model request
// that produced it, and a start the plugin makes from its own timer has none, so it is refused ("gave no verdict"). A hire Clawd
// makes with the Agent tool is judged like any other: never a way around the person's permission mode. The scout's brief goes into
// its own definition (scout-spec.ts), so his call stays short and is judged exactly as he wrote it; no hook rewrites it.
// Plain state, no `$`: the timer comes in as a closure. One ask at a time, so the two ways to start a scout never both run.
import { SCOUT_SPEC, SCOUT_TYPE, scoutSpecWith } from './scout-spec'

type Timer = { readonly cancel: () => void }
type After = (ms: number, fn: () => void) => Timer
type SpawnResult = { readonly agentId?: string; readonly deny?: string }

/** How long setup waits for Clawd's hire: it comes on his next turn, which waits for the person's next message. */
export const CLAWD_WAIT_MS = 600_000

/** The engine's refusal of a start no model request asked a verdict for (auto mode). Other refusals would refuse his hire too. */
export const isClassifierRefusal = (reason: string): boolean => /auto mode classifier/i.test(reason)

const NOTE = `Clawd HQ setup asks one thing of you this turn, before the person's request: hire its scout with the Agent tool, `
  + `subagent_type "${SCOUT_TYPE}", description "Look around the project", prompt "Look around this project and pick its starting team.", `
  + 'run_in_background true. Its brief is already in its definition. About it, tell the person only "Setting up your team…". '
  + 'When the scout\'s report comes back, do not repeat or discuss it: Clawd HQ reads it and shows the team on the Office tab.'

const REFUSED = 'Clawd HQ starts its scout itself; no setup is waiting for one now.'

export type ScoutHandoff = {
  /** Asks Clawd for the hire: his scout's id once he makes it, or `undefined` when `ms` pass first or an ask is already open. `brief` is the one in the scout's definition for this ask. */
  readonly ask: (ms: number, after: After, brief?: string) => Promise<string | undefined>
  readonly isOpen: () => boolean
  /** The open ask's brief; `undefined` when no ask is open or it was opened without one. */
  readonly brief: () => string | undefined
  /** The note for Clawd's next turn while an ask is open. */
  readonly note: () => string | undefined
  /** A scout Clawd started: taken when an ask is open, which it closes; `false` when none is. */
  readonly take: (id: string) => boolean
  /** Closes an open ask as if no hire came: the setup that asked was for a folder the session has left (issue #5). */
  readonly drop: () => void
}

export function createScoutHandoff(): ScoutHandoff {
  let waiting: { readonly done: (id: string | undefined) => void; readonly timer: Timer; readonly brief?: string } | undefined
  const close = (id: string | undefined) => {
    const was = waiting
    waiting = undefined
    was?.timer.cancel()
    was?.done(id)
  }
  return {
    ask: (ms, after, brief) => {
      if (waiting !== undefined) return Promise.resolve(undefined)
      return new Promise(done => {
        const timer = after(ms, () => close(undefined))
        waiting = { done, timer, ...(brief === undefined ? {} : { brief }) }
      })
    },
    isOpen: () => waiting !== undefined,
    brief: () => waiting?.brief,
    note: () => (waiting === undefined ? undefined : NOTE),
    take: id => {
      if (waiting === undefined) return false
      close(id)
      return true
    },
    drop: () => close(undefined),
  }
}

/** The session's one hand-off: setup asks through it, the hooks (offer, spawn, prompt) read it. */
export const scoutHandoff = createScoutHandoff()

/** What asking Clawd needs from the host: re-registering the scout with its brief, and a timer. */
export type AskIo = { readonly register: (spec: ReturnType<typeof scoutSpecWith>) => Promise<unknown>; readonly after: After }

/** Puts the brief into the scout's definition, then asks Clawd for the hire; `undefined` when that cannot be set up or he makes none in time. */
export async function askClawd(io: AskIo, brief: string, handoff: ScoutHandoff = scoutHandoff): Promise<string | undefined> {
  const isReady = await io.register(scoutSpecWith(brief)).then(() => true, () => false)
  return isReady ? handoff.ask(CLAWD_WAIT_MS, io.after, brief) : undefined
}

/**
 * The scout's definition prompt as it must be registered now: with the open ask's brief, else the bare one. A session start registers
 * the scout again; with the bare prompt there, Clawd's hire (its prompt is one short line) would reach a scout with no candidate list.
 */
export function scoutPromptNow(handoff: ScoutHandoff = scoutHandoff): string {
  const brief = handoff.brief()
  return brief === undefined ? SCOUT_SPEC.prompt : scoutSpecWith(brief).prompt
}

/**
 * The agent.spawn hook's answer for the scout's type. The plugin's own start passes as it is. A hire by anyone else passes only
 * while an ask is open, and is then taken; with none open it is refused, so a stray or late hire never starts a second scout.
 */
export async function handScoutSpawn<R extends SpawnResult>(handoff: ScoutHandoff, isOwn: boolean, next: () => Promise<R>): Promise<R | { readonly deny: string }> {
  if (isOwn) return next()
  if (!handoff.isOpen()) return { deny: REFUSED }
  const r = await next()
  if (r.agentId !== undefined) handoff.take(r.agentId)
  return r
}

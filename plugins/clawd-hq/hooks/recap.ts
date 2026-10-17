// The recap on Clawd's card: one line on where things stand, made the way Claude Code's own session recap is.
// When one is due, how its line reads, and the steps of asking for one. `$` never leaves register.tsx: it hands in
// the calls as `io`.
import type { Boss } from '../types'
import { fit } from './desk'
import { side } from './side-ask'

/** Quiet time after the last finished turn before a recap is made. */
export const RECAP_AFTER_MS = 3 * 60_000
/** A session shorter than this has nothing to recap. */
export const RECAP_MIN_TURNS = 3
/** The model is asked for 200 characters; a reply that runs a little over is still shown whole, a runaway one is cut here. */
export const RECAP_CHARS = 280

/** Asked over the session's own transcript, so the model answers from everything said so far. */
export const RECAP_PROMPT =
  'The user stepped away and is coming back. Write a recap of this session as plain text, in at most two short sentences and 200 characters: ' +
  'first what we are working on, in a few words, then the next step. Leave out what is already done, and every detail the next step does not need. ' +
  'Everyday words. No preamble, no markdown, no line breaks.'

export type RecapState = {
  /** The setting is on and someone can see the panel. */
  isOn: boolean
  /** Clawd is in a turn, or the tour is playing. */
  isBusy: boolean
  /** When the last turn finished; 0 before any has. */
  idleSince: number
  now: number
  /** Clawd's turns this session. */
  turns: number
  /** The turn count the last recap was asked at: one recap per pause, never two in a row. */
  lastFor: number
}

export function isRecapDue(s: RecapState): boolean {
  if (!s.isOn || s.isBusy || s.idleSince <= 0) return false
  return s.turns >= RECAP_MIN_TURNS && s.turns !== s.lastFor && s.now - s.idleSince >= RECAP_AFTER_MS
}

/**
 * The model's reply as the card shows it: one line, cut at a word when it runs long; nothing when it said nothing.
 * The reply follows the transcript, tool output included, so it is untrusted text: control characters become spaces.
 */
export function recapLine(text: string): string | undefined {
  return fit(text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' '), RECAP_CHARS) || undefined
}

// ---- Asking for one: the counts below belong to this session, the calls come in as `io` ----

/** Whether the recap may be made here, Clawd's turns this session, and the turn count the last one was asked at. */
let isRecapOn: () => boolean = () => true
let turnsSeen = 0
let recapFor = 0

/** The setting only, read at each frame's ask (a switch pressed in Settings applies at once), as is whether anything is drawn. */
export const setRecapOn = (isOn: () => boolean) => { isRecapOn = isOn }
/** A turn of Clawd's began: work goes on, so the count moves. */
export const noteRecapTurn = () => { turnsSeen += 1 }

export type RecapIo = {
  now: () => Promise<number>
  boss: () => Promise<Boss>
  setBoss: (fn: (b: Boss) => Boss) => Promise<unknown>
  /** The tour is playing. */
  isTouring: () => Promise<boolean>
  /** Something is drawn for the person to look at. */
  isShown: () => Promise<boolean>
  ask: (prompt: string) => Promise<{ isAnswered: true; text: string } | { isAnswered: false }>
}

/**
 * Asks the model over the session's own transcript, which the API serves from the main thread's cache, as Claude
 * Code's own session recap does. Once per pause: the turn count is noted before the question goes out. Only while no
 * other side question runs or waits (hooks/side-ask.ts); a later frame tries again.
 */
export async function maybeRecap(io: RecapIo) {
  const [b, isTouring, now] = [await io.boss(), await io.isTouring(), await io.now()]
  if (!isRecapDue({ isOn: isRecapOn(), isBusy: b.isBusy || isTouring, idleSince: b.idleSince, now, turns: turnsSeen, lastFor: recapFor })) return
  // A recap is for someone looking at the panel: none while nothing is drawn. Read only once one is due, to keep frames cheap.
  if (!(await io.isShown())) return
  side.tryNow(() => askRecap(io))
}

async function askRecap(io: RecapIo) {
  const asked = turnsSeen
  recapFor = asked
  const reply = await io.ask(RECAP_PROMPT)
  const text = reply.isAnswered ? recapLine(reply.text) : undefined
  // A turn that began while the model was answering has made the line stale: it is dropped.
  if (text !== undefined && asked === turnsSeen) await io.setBoss(boss => (boss.isBusy ? boss : { ...boss, recap: text }))
}

/** A new session, or a /clear: the turns are counted afresh and an old recap goes. */
export async function resetRecap(io: RecapIo) {
  turnsSeen = 0
  recapFor = 0
  if ((await io.boss()).recap !== undefined) await io.setBoss(b => ({ ...b, recap: undefined }))
}

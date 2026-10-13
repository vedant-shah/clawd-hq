// The recap on Clawd's card: one line on where things stand, made the way Claude Code's own session recap is.
// Pure: when one is due and how its line reads. register.tsx asks the model (`$` never leaves that file).
import { fit } from './desk'

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

// When a piece of work has closed, pure: the coffee break button is offered only at such a checkpoint, never between the steps of a job.
// A specialist handing its work back starts it; Clawd's own turn that reports it closes it, even if it ends with a question; the person's
// next message ends it. Clawd's card (the boss) keeps the two marks.
import type { Boss } from '../types'

/** Prompts that come from the person: their own Enter, the remote bridge, a script's host. A notification, a peer, a schedule or a plugin is not. */
const PERSON_ORIGINS = new Set(['composer', 'bridge', 'sdk'])

/** A specialist handed its work back: no checkpoint until Clawd has reported it, in a turn that starts after this. */
export const withHandBack = (b: Boss): Boss => ({ ...b, handedBackAt: b.turns, isCheckpoint: false })

/** The person sent a message: what closed before it is behind us. */
export const withPersonSpoke = (b: Boss): Boss => ({ ...b, handedBackAt: undefined, isCheckpoint: false })

/**
 * Clawd's turn ended. It closes a piece of work when a specialist handed work back in an earlier turn (the turn it arrived in is not
 * the report: the report is a turn that started after it) and the turn ended in an answer. A report that ends with a plain-text
 * question ("what next?") still counts; an open question box keeps the turn busy, so the button waits for it elsewhere.
 * A turn that is not that leaves no checkpoint standing.
 */
export function withTurnEnd(b: Boss, end: { reason: string }): Boss {
  const isReport = b.handedBackAt !== undefined && b.turns > b.handedBackAt
  const isClosed = isReport && end.reason === 'answer'
  return b.isCheckpoint === isClosed ? b : { ...b, isCheckpoint: isClosed }
}

/** A prompt that is the person's own message to Clawd: not from a notification, a peer or a schedule, and not a slash command. */
export const isPersonMessage = (e: { text: string; origin?: { kind: string } }): boolean =>
  (e.origin === undefined || PERSON_ORIGINS.has(e.origin.kind)) && !e.text.trimStart().startsWith('/')
